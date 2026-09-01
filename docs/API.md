# API Reference — @vllnt/convex-invitations

**Compatibility:** `convex@^1.41.0`

Construct the client with the mounted component and optional host validators/config:

```ts
import { Invitations } from "@vllnt/convex-invitations";
import { v } from "convex/values";

const invites = new Invitations<MyRole, MyPayload>(components.invitations, {
  ttlMs: 1000 * 60 * 60 * 24 * 3, // default link lifetime (ms); defaults to 7 days
  generateToken: () => crypto.randomUUID(), // token minter; this is the default
  roleValidator: v.union(v.literal("admin"), v.literal("member")).parse, // narrow role
  payloadValidator: v.object({ seats: v.number() }).parse, // narrow payload
});
```

`Invitations<TRole = unknown, TPayload = unknown>` is generic over the host's opaque
`role` and `payload` types. All methods take the host `ctx` (a query or mutation
context) as the first argument.

**Time is server-sourced.** Every handler stamps `createdAt`/`acceptedAt`/`revokedAt`
from `Date.now()` itself; no method accepts a caller-supplied clock. (`expiresAt` is
the one absolute timestamp the host may set — directly, or derived from `ttlMs`.)

**Validation.** When `roleValidator` / `payloadValidator` are set they run at the
client boundary: over the value written by `issue` (before storage) and over the
value returned by `getByToken` / `accept` (on read). Each must return the typed value
or throw. Omit them to leave the opaque data unvalidated.

## Mutations

### `issue(ctx, resourceRef, opts?) → { token, expiresAt }`

`opts`: `{ role?: TRole; inviterRef?: string; inviteeRef?: string; payload?: TPayload;
ttlMs?: number; expiresAt?: number }`.

Record a `pending` invitation to the opaque `resourceRef` and return its single-use
`token` (minted by `generateToken`) plus its absolute `expiresAt`. Expiry resolves to
`opts.expiresAt` if given, else `now + (opts.ttlMs ?? the client default)`.
`role`/`payload` are opaque host data validated against the host validators before
storage; `inviterRef`/`inviteeRef` are opaque host subjects (omit `inviteeRef` for an
open link). `createdAt` is stamped from the server clock.

The token must be unique — a collision throws
`ConvexError({ code: "DUPLICATE_TOKEN" })`. New invitations return the raw bearer token once and
persist/index only its SHA-256 digest. The bounded migration below removes raw tokens from
pre-upgrade rows.

### `accept(ctx, token, acceptedBy) → InvitationGrant`

`InvitationGrant` is `{ resourceRef: string; role?: TRole; payload?: TPayload }`.

Redeem an invitation by its `token` for the opaque `acceptedBy` subject — the
single-use accept. Atomically transitions the invite to `accepted` (recording
`acceptedAt` + `acceptedBy`) and returns the grant the host applies (writes a
membership, grants a role). Two racing accepts yield exactly one winner.

**Single-use + terminal states are final.** Accepting a missing, expired, or
already-terminal invite is rejected — a replayed link can never double-grant. A
past-`expiresAt` invite is rejected with `EXPIRED` but is **not** flipped to `expired`
here (a thrown mutation rolls back its own writes); the read-time check still rejects
it, and `peek`/the cron persist the sweep.

- `ConvexError({ code: "NOT_FOUND" })` — no invitation has `token`.
- `ConvexError({ code: "EXPIRED" })` — the invite's TTL has elapsed.
- `ConvexError({ code: "ALREADY_ACCEPTED" | "ALREADY_REVOKED" | "ALREADY_EXPIRED" })` — the invite is already terminal.

### `revoke(ctx, token) → null`

Cancel a still-`pending` invitation, transitioning it to `revoked` (recording
`revokedAt`). A revoked invite can never be accepted; a revoke racing an accept yields
exactly one winner. Rejects a missing id (`NOT_FOUND`) and an already-terminal invite
(`ALREADY_<STATE>`).

### `peek(ctx, token) → InvitationView | null`

The current view of one invitation **with read-time TTL enforcement**: a `pending`
invite found past its `expiresAt` is flipped to `expired` and returned as such. Runs
as a mutation because it may write that one transition. Returns `null` for a missing
token. Use `getByToken` for a pure reactive read.

### `migrateLegacyTokens(ctx, batch?) → number`

Hash and remove raw bearer tokens from up to 50 pre-upgrade rows by default (maximum 100). A full
batch self-reschedules, and the built-in daily cron drives the migration automatically. Direct
lookup, accept, revoke, and duplicate detection remain compatible while migration is in progress.

### `prune(ctx, opts?) → number`

`opts`: `{ before?: number; retentionBefore?: number; batch?: number }` (defaults:
`before = Date.now()`, `retentionBefore = Date.now() - 30 days`, `batch = 200`).

Two bounded passes, oldest first: first delete up to `batch` **terminal** invites
whose `createdAt < retentionBefore` (the retention sweep, across
`accepted`/`revoked`/`expired`), then with the remaining budget flip `pending` invites
whose `expiresAt < before` to `expired` (the TTL sweep). Retention runs before TTL so
a row flipped this pass is not also deleted this pass (it is deleted next pass).
Returns the total touched in the first pass. If a full batch was touched the sweep
self-reschedules through the component scheduler until the tail is clean. Idempotent —
safe to run anytime. A built-in daily cron drives it automatically; call `prune`
directly only for an extra or custom-cadence sweep.

## Queries

### `getByToken(ctx, token) → InvitationView | null`

The current view of one invitation by its `token`, or `null` if no such invite is
held. A **pure read** — it reports the stored `state` as-is and does NOT flip a stale
`pending` invite to `expired` (a query cannot write). Compare `expiresAt` against the
clock, or call `peek` when you need read-time TTL enforcement. `InvitationView` is
`{ token, resourceRef, role?, inviterRef?, inviteeRef?, payload?, state, createdAt,
expiresAt, acceptedAt?, acceptedBy?, revokedAt? }`; `role`/`payload` are narrowed by
the host validators when set.

### `listPending(ctx, resourceRef, paginationOpts) → PaginationResult<InvitationMetadata>`

Page the still-`pending` invitations for one `resourceRef`, oldest first via the
`by_resource_state` index. Takes the standard Convex `paginationOpts` and returns the
standard paginated envelope (`page`, `isDone`, `continueCursor`) with metadata only and no
bearer token. Past-TTL invites may
still appear `pending` here until a `peek`/`accept`/cron sweep flips them; compare
`expiresAt` against the clock to hide stale ones in the host UI.

### `listByResourceState(ctx, resourceRef, state, paginationOpts) → PaginationResult<InvitationMetadata>`

Page invitations for one `resourceRef` in a given `state` (`"pending" | "accepted" |
"revoked" | "expired"`), oldest first — for an accepted/revoked/expired audit surface.
Same metadata-only envelope as `listPending`; bearer tokens are excluded.

## Error codes

Coded `ConvexError`s thrown by the component (`error.data.code`):

| Code | Thrown by | Meaning |
|------|-----------|---------|
| `DUPLICATE_TOKEN` | `issue` | An invitation with this `token` already exists. |
| `NOT_FOUND` | `accept`, `revoke` | No invitation has this `token`. |
| `EXPIRED` | `accept` | The invitation's TTL (`expiresAt`) has elapsed. |
| `ALREADY_ACCEPTED` / `ALREADY_REVOKED` / `ALREADY_EXPIRED` | `accept`, `revoke` | The invitation is already terminal and cannot transition. |

## Cron / Maintenance

The component registers two crons (`crons.ts`):

| Job | Cadence | Action |
|-----|---------|--------|
| `invitations:migrate-legacy-tokens` | every 24h (`PRUNE_INTERVAL`) | hashes and removes raw tokens from up to 50 pre-upgrade rows, self-rescheduling until migration is complete |
| `invitations:prune` | every 24h (`PRUNE_INTERVAL`) | runs `prune` with `batch = PRUNE_BATCH` (200) — expires stale pending invites and deletes terminal invites past retention, self-rescheduling until the tail is clean |

Cadence is a static module constant (Convex cron definitions are static per
deployment). A host wanting a different cadence drives `prune` from its own scheduler
with explicit cutoffs. The cron is per-mount, so each `app.use(component, { name })`
instance sweeps its own sandbox independently. Default TTL is 7 days; default
retention is 30 days.
