# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-06-14

### Added

- First release of `@vllnt/convex-invitations` — the invite → accept → expire
  flow as a Convex component.
- `issue(resourceRef, { role?, inviterRef?, inviteeRef?, payload?, ttlMs?,
  expiresAt? })` records a `pending` invitation and returns its single-use
  `token` (to deliver out of band) plus its absolute `expiresAt`; the token must
  be unique.
- `accept(token, acceptedBy)` consumes the invite (single-use, `pending →
  accepted`) and returns the grant (`resourceRef` + opaque `role`/`payload`) the
  host applies; two racing accepts yield exactly one winner.
- `revoke(token)` cancels a still-`pending` invite; `peek(token)` reads with
  read-time TTL enforcement (flips a stale pending invite to `expired`);
  `getByToken(token)` is a pure reactive read; `listPending(resourceRef,
  paginationOpts)` and `listByResourceState` page an org's invites.
- Single-use + terminal states are final: accepting or revoking an `accepted`/
  `revoked`/`expired` invite is rejected with a coded `ConvexError`, so a replayed
  link can never double-grant.
- TTL enforced on read: accepting a past-`expiresAt` invite is rejected with
  `EXPIRED` (a thrown accept does not persist a flip — `peek`/the cron sweep
  `pending → expired` instead).
- Server-sourced time: every handler stamps `createdAt`/`acceptedAt`/`revokedAt`
  from `Date.now()` inside the mutation — no caller-supplied clock.
- Typed generics: `Invitations<TRole, TPayload>` with optional `roleValidator` /
  `payloadValidator` host parsers narrowing the opaque stored `role`/`payload` at
  the client boundary on write and read — no `v.any()` dump, no unchecked cast.
  Configurable `ttlMs` and `generateToken`.
- Bounded, self-rescheduling `prune` (retention delete of terminal invites +
  TTL sweep of stale pending invites) plus a built-in daily prune cron
  (`crons.ts`); idempotent. Default TTL 7 days, default retention 30 days.
- Mount-safe: correct under multiple `app.use(component, { name })` mounts — each
  instance is sandboxed, the cron is registered per instance.
- Minimal stage: the invite (including its token) is modelled self-contained; a
  later version delegates the hashed token to `@vllnt/convex-tokens` and the
  granted membership to `@vllnt/convex-memberships`.
