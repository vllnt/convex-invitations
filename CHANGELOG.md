# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Breaking

- Pending/history list pages now return token-free `InvitationMetadata` projections. Consumers that
  previously read `page[].token` must retain the one-time `issue()` result for delivery and use
  `peek(token)` / `getByToken(token)` for direct token lookup.

### Fixed

- Apply the documented 30-day default retention window to terminal invitations instead of
  deleting them on the next daily sweep.
- Reject invalid prune batch sizes to prevent infinite self-scheduling and oversized transactions.
- Store only SHA-256 invitation-token digests and remove bearer tokens from pending/history list
  projections; raw tokens are returned only when issued and accepted only for direct lookup.
- Migrate pre-upgrade raw bearer tokens opportunistically on mutation and through a bounded daily
  backfill while preserving direct lookup and duplicate detection during the transition.

### Changed

- Treat Convex `_generated` output as CLI-owned, exclude it from formatting, and expose a
  dedicated codegen script.
- Refresh all direct dependencies to their latest compatible releases for canary validation.
- Require `convex@^1.45.0` and update `convex-test` to `^0.0.56`.

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
