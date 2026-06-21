<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `example/convex/_generated/ai/guidelines.md` first** for
important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

# @vllnt/convex-invitations

The invite → accept → expire flow, as a Convex component. A host mutation issues a single-use,
expiring invitation to an opaque resource and gets back a token to hand to the invitee out of band;
the invitee redeems it with `accept` (single-use, returns the grant the host applies); a still-open
invite can be revoked, and an unaccepted invite expires when its TTL elapses. It follows the vllnt
Component Standard (see the `convex-components` hub `.claude/rules/component-standard.md`).

## Architecture

```
src/
├── shared.ts              # constants: component name, lifecycle states, TTL, retention, batch size
├── test.ts                # convex-test register() helper
├── client/
│   ├── index.ts           # Invitations<TRole, TPayload> class (consumer-facing API)
│   └── types.ts           # public TypeScript interfaces
└── component/
    ├── schema.ts           # sandboxed table: invitations {token, resourceRef, role?, inviterRef?, inviteeRef?, payload?, state, createdAt, expiresAt, acceptedAt?, acceptedBy?, revokedAt?}
    ├── convex.config.ts    # defineComponent("invitations")
    ├── mutations.ts        # issue, accept, revoke, peek, prune
    ├── queries.ts          # getByToken, listPending, listByResourceState
    ├── validators.ts       # shared validators (invitationState, invitationView, jsonValue)
    └── crons.ts            # daily prune cron (self-rescheduling)
```

Sandboxed table: `invitations` — indexed `by_token` (redemption/lookup), `by_resource_state`
(pending-per-resource listing + audit), `by_state_expires` (TTL expiry sweep), and `by_state_created`
(retention sweep). No host tables are touched. The stored `role`/`payload` are opaque to the
component; the host narrows them via `roleValidator`/`payloadValidator` at the client boundary.

## Ownership boundary

**Component owns:**

- The invitation envelope (`invitations` table) — issue, accept, revoke, expire, prune
- Minting the single-use `token` (via the client's `generateToken`) and enforcing its uniqueness
- Server-sourced time — `Date.now()` inside every handler stamps `createdAt`/`acceptedAt`/`revokedAt`; no caller clock
- The lifecycle state machine: `pending → accepted | revoked | expired`, single-use, terminal states final
- TTL enforcement on read (accept/peek) and the daily prune cron (expire stale pendings + delete terminal past retention)

**Host owns:**

- The resource being invited to and its domain meaning (`resourceRef`, `role`, `payload`)
- Auth and authorization — whether a caller may issue, accept, or revoke a given invite
- Delivery of the token (email, link) — the component returns the token, never sends it
- Resolving identity into the opaque `inviterRef`/`inviteeRef`/`acceptedBy` subjects
- Applying the grant on accept (writing a membership, granting a role) — the component returns it, the host persists it
- The stored `role`/`payload` types (`TRole`/`TPayload`) — opaque to the component, narrowed by host validators

**Auth:** the component is completely auth-agnostic. The host resolves identity, decides access, and
gates who may read/deliver the token. There is no built-in scope dimension — the host namespaces its
`resourceRef`s itself, or mounts a second instance (`app.use(component, { name })`) for a static
partition.

## Key design decisions

- **Single-use + terminal states are final (the core invariant):** `accept` and `revoke` reject any
  transition out of `accepted`/`revoked`/`expired` with a coded `ConvexError`. A replayed link or a
  duplicate accept — common with at-least-once delivery — can never double-grant. The single
  check-and-patch in one mutation also means two racing accepts yield exactly one winner.

- **TTL enforced on read, but accept does not flip on expiry:** accepting a past-`expiresAt` invite
  throws `EXPIRED`. A thrown mutation rolls back its own writes, so `accept` does NOT persist a
  `pending → expired` flip (that write would be lost anyway). The non-throwing `peek` mutation and the
  prune cron persist the sweep instead. The invite can never be accepted regardless.

- **`peek` (mutation) vs `getByToken` (query):** a Convex query cannot write, so `getByToken` reports
  the stored `state` as-is (a stale pending may still read `pending`). `peek` is a mutation that flips
  a stale pending to `expired` and returns it — read-time TTL enforcement when the host wants it.

- **Component-minted token, host-supplied generator:** the client mints the token (`crypto.randomUUID`
  by default, overridable via `generateToken`) so the host never has to; uniqueness is enforced in
  `issue` (a collision throws `DUPLICATE_TOKEN`). At this minimal stage the token is stored as-is — a
  later version hashes it via `@vllnt/convex-tokens`.

- **Typed-generic opaque data, never `v.any()` dumped raw:** `role`/`payload` ride through the single
  documented `jsonValue` alias and are narrowed to `TRole`/`TPayload` by host parsers at the client
  boundary on both write and read — no unchecked cast.

- **`accept` returns the grant; the host applies it:** the component returns `{ resourceRef, role?,
  payload? }` and the host writes its own membership. This keeps the host-table write (which a
  sandboxed component cannot do) on the host side — and is exactly where a future version delegates to
  `@vllnt/convex-memberships`.

- **Bounded prune, retention-before-TTL ordering:** `prune` deletes terminal invites past retention
  FIRST, then flips stale pendings to `expired` — so a row flipped this pass is not also deleted this
  pass (double-count); it is deleted next pass. Bounded per `batch`, self-reschedules via
  `ctx.scheduler`. Idempotent; the built-in daily cron drives it. Default TTL 7 days, retention 30 days.

- **Backend-only (no `./react` entry):** an invite-management surface is an ordinary reactive
  `useQuery` over the host's own re-exported `getByToken`/`listPending` refs — a dedicated hook would
  wrap the host's `api` with no added value, and the token is delivered by the host, not revealed in a
  client component. Explicit analysis decision (see README); re-run when a real management-surface
  consumer appears.

## Conventions

- Mutations in `mutations.ts`, queries in `queries.ts` (enforced by `@vllnt/eslint-config/convex`).
- Explicit `args` + `returns` on every Convex function.
- Host data via typed generics / host validators — never `v.any()` dumps; `jsonValue` is the documented
  last resort for the stored opaque `role`/`payload`.
- 100% test coverage is BLOCKING (`vitest.config.mts` thresholds: statements, branches, functions, lines).
- Runtime deps: only official `@convex-dev/*` + `@vllnt/*`.

## Docs sync

| Changed | Update in the same commit |
|---------|--------------------------|
| Public API (issue/accept/revoke/peek/getByToken/listPending/listByResourceState/prune signatures) | README API Reference table, `docs/API.md`, `llms.txt` context |
| Config options / defaults (validators, TTL, retention, generateToken, batch) | README API Reference, `docs/API.md` constructor section |
| Schema / table / indexes | README Architecture, `docs/API.md` |
| Error codes | `docs/API.md` → `## Error codes` table |
| `peerDependencies.convex` version | `llms.txt` context line (`convex@^X.Y.Z`), `docs/API.md` Compatibility line, README Installation peer note |
| Lifecycle / state machine | `docs/API.md` mutation sections, Key design decisions above |

Grep old values before committing (e.g. after a `peerDependencies.convex` bump, `git grep "1.41.0"` → only the new range survives).
