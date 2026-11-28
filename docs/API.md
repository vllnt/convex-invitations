# API Reference — @vllnt/convex-invitations

**Compatibility:** `convex@^1.45.0`. Node.js as your convex version requires
(`>=20.0.0` for convex 1.45 to 1.48, `>=22.0.0` for 1.49 and newer).

## Entry points

| Import                                           | Exports                                                                                                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@vllnt/convex-invitations`                      | `Invitations` class; types `InvitationsComponent`, `InvitationsOptions`, `IssueOptions`, `InvitationView`, `InvitationMetadata`, `InvitationGrant`, `InvitationState`, `Parser` |
| `@vllnt/convex-invitations/convex.config`        | the component definition (default export) for `app.use(...)`                                                                                                                    |
| `@vllnt/convex-invitations/_generated/component` | type `ComponentApi` (types only)                                                                                                                                                |
| `@vllnt/convex-invitations/test`                 | `register(t, name = "invitations")` to mount the component in a `convex-test` instance                                                                                          |

`./convex.config.js` and `./_generated/component.js` are aliases of the entries
above; `./package.json` is also exported.

## Client

### `Invitations`

```ts
// convex/invites.ts
import { Invitations } from "@vllnt/convex-invitations";

import { components } from "./_generated/api";

const invites = new Invitations<"admin" | "member", { seats: number }>(
  components.invitations,
  {
    ttlMs: 3 * 24 * 60 * 60 * 1000, // default link lifetime in ms; defaults to 7 days
    generateToken: () => crypto.randomUUID(), // token minter; this is the default
    roleValidator: (value) => {
      if (value !== "admin" && value !== "member") throw new Error("bad role");
      return value;
    },
    payloadValidator: (value) => {
      if (
        typeof value !== "object" ||
        value === null ||
        !("seats" in value) ||
        typeof value.seats !== "number"
      ) {
        throw new Error("expected numeric seats");
      }
      return { seats: value.seats };
    },
  },
);
```

`new Invitations<TRole = unknown, TPayload = unknown>(component: InvitationsComponent, options?: InvitationsOptions<TRole, TPayload>)`.
`component` is `components.invitations` (or `components.<name>` for a named
mount). See [`InvitationsOptions`](#invitationsoptions) for the options.

Every method takes the host `ctx` first. Methods marked mutation need a `ctx`
with `runMutation` (a mutation or action context); methods marked query need a
`ctx` with `runQuery` (a query, mutation or action context). Called from an
action, each method runs in its own transaction.

**Time is server-sourced.** The component stamps `createdAt`, `acceptedAt` and
`revokedAt` with `Date.now()` inside its own handlers. `expiresAt` is the only
timestamp the host sets, directly or through `ttlMs`.

**Validation.** `roleValidator` and `payloadValidator` run in the client: on
the value passed to `issue` (before storage) and on the value returned by
`accept`, `peek`, `getByToken`, `listPending` and `listByResourceState`. An
`undefined` value skips the validator. Without a validator the value is passed
through unchecked.

### `issue`

Mutation.
`issue(ctx, resourceRef: string, opts?: IssueOptions<TRole, TPayload>): Promise<{ token: string; expiresAt: number }>`

Creates a `pending` invitation to the opaque `resourceRef` and returns the raw
single-use `token` (minted by `generateToken`) and the absolute `expiresAt`.
Expiry is `opts.expiresAt` if set, else `Date.now() + (opts.ttlMs ?? client ttlMs)`;
the client `ttlMs` defaults to 7 days (`604_800_000` ms). Only the SHA-256
digest of the token is stored; this is the only time the raw token is returned.

Errors: `INVALID_TOKEN` (generated token empty or longer than 512 characters),
`INVALID_ARGUMENT` (empty `resourceRef`; `inviterRef` or `inviteeRef` given as
`""`; `expiresAt` not finite or not after the server time), `DUPLICATE_TOKEN`
(another invitation already uses this token). A validator error is thrown
before the component is called.

### `accept`

Mutation.
`accept(ctx, token: string, acceptedBy: string): Promise<InvitationGrant<TRole, TPayload>>`

Consumes a `pending` invitation: sets `state: "accepted"`, `acceptedAt` and the
opaque `acceptedBy`, and returns the [`InvitationGrant`](#invitationgrant)
`{ resourceRef, role?, payload? }` for the host to apply. The check and the
write are one mutation, so two racing accepts have exactly one winner.
`inviteeRef` is not compared with `acceptedBy`.

Checks, in order: token length (`INVALID_TOKEN`), non-empty `acceptedBy`
(`INVALID_ARGUMENT`), the invitation exists (`NOT_FOUND`), its state is
`pending` (`ALREADY_ACCEPTED`, `ALREADY_REVOKED` or `ALREADY_EXPIRED`), and
`expiresAt` is after the server time (`EXPIRED`). An `EXPIRED` invitation stays
`pending` in storage, because a throwing mutation rolls back its writes; `peek`
and `prune` store the `expired` state.

### `revoke`

Mutation. `revoke(ctx, token: string): Promise<null>`

Sets a `pending` invitation to `revoked` and stamps `revokedAt`. It does not
check `expiresAt`, so a past-TTL invitation still stored as `pending` is
revoked. Errors: `INVALID_TOKEN`, `NOT_FOUND`, and `ALREADY_ACCEPTED`,
`ALREADY_REVOKED` or `ALREADY_EXPIRED` for a terminal invitation. A revoke
racing an accept has one winner.

### `peek`

Mutation.
`peek(ctx, token: string): Promise<InvitationView<TRole, TPayload> | null>`

Returns the [`InvitationView`](#invitationview) of one invitation, or `null`
when no invitation has this token. If the invitation is `pending` and
`expiresAt` is not after the server time, it stores `state: "expired"` first
and returns the expired view. Throws `INVALID_TOKEN` for an empty or over-long
token. The returned `token` is the one you passed in.

### `getByToken`

Query.
`getByToken(ctx, token: string): Promise<InvitationView<TRole, TPayload> | null>`

Returns the [`InvitationView`](#invitationview) as stored, or `null` when no
invitation has this token, including for an empty or over-long token (no
error, so a reactive UI can pass a placeholder). It never writes: a past-TTL
invitation still reads `pending`. Compare `expiresAt` with the clock, or call
`peek`. The returned `token` is the one you passed in.

### `listPending`

Query.
`listPending(ctx, resourceRef: string, paginationOpts: PaginationOptions): Promise<PaginationResult<InvitationMetadata<TRole, TPayload>>>`

One page of the invitations stored as `pending` for `resourceRef`, oldest
`createdAt` first, as the standard Convex pagination result (`page`, `isDone`,
`continueCursor`, and `splitCursor`/`pageStatus` when Convex sets them). Rows
are [`InvitationMetadata`](#invitationmetadata): no token and no digest.
Past-TTL invitations still appear until `peek` or `prune` stores `expired`.

### `listByResourceState`

Query.
`listByResourceState(ctx, resourceRef: string, state: InvitationState, paginationOpts: PaginationOptions): Promise<PaginationResult<InvitationMetadata<TRole, TPayload>>>`

Same as `listPending` for any stored `state` (`"pending"`, `"accepted"`,
`"revoked"` or `"expired"`), for history and audit screens. The built-in daily
cron deletes terminal rows once their `createdAt` is more than 30 days old.

### `migrateLegacyTokens`

Mutation. `migrateLegacyTokens(ctx, batch?: number): Promise<number>`

Replaces the raw `token` stored on rows written before hashed storage with its
SHA-256 digest, up to `batch` rows per pass (default 50, integer from 1 to 100,
else `INVALID_BATCH`). A full batch schedules another pass. Returns the count
of the first pass only. The built-in daily cron also runs it, and a legacy row
found by `peek`, or by an `accept` or `revoke` that succeeds, is migrated then. Lookups by token keep
working during the migration.

### `prune`

Mutation.
`prune(ctx, opts?: { before?: number; retentionBefore?: number; batch?: number }): Promise<number>`

Defaults: `before = Date.now()`, `retentionBefore = Date.now() - 30 days`,
`batch = 200`. `batch` must be an integer from 1 to 500 (`INVALID_BATCH`);
`before` and `retentionBefore` must not be `NaN` (`INVALID_ARGUMENT`) and may
be `Infinity`.

One pass, oldest first, touches at most `batch` rows:

1. Deletes `accepted`, then `revoked`, then `expired` invitations whose
   `createdAt < retentionBefore`.
2. With the remaining budget, sets `pending` invitations whose
   `expiresAt < before` to `expired`.

Deleting before expiring means a row expired in this pass is deleted in a later
pass, not twice in one. If the pass touched `batch` rows, it schedules another
pass with the same cutoffs. Returns the count of the first pass. Calling it does
not change the built-in cron (see [Cron and maintenance](#cron-and-maintenance)).

## Types

### `InvitationsComponent`

The type of `components.invitations` as the client uses it: the component's
`mutations` (`issue`, `accept`, `revoke`, `peek`, `migrateLegacyTokens`,
`prune`) and `queries` (`getByToken`, `listPending`, `listByResourceState`)
function references, with `role` and `payload` typed `unknown`.

### `InvitationsOptions`

`{ ttlMs?: number; generateToken?: () => string; roleValidator?: Parser<TRole>; payloadValidator?: Parser<TPayload> }`

| Option             | Default               | Meaning                                                                   |
| ------------------ | --------------------- | ------------------------------------------------------------------------- |
| `ttlMs`            | `604_800_000` (7 days) | Lifetime of an invite when `issue` gets neither `ttlMs` nor `expiresAt`  |
| `generateToken`    | `crypto.randomUUID()` | Mints each token; must return 1 to 512 characters, unpredictable, unique |
| `roleValidator`    | none                  | [`Parser`](#parser) for `role` on write and read                         |
| `payloadValidator` | none                  | [`Parser`](#parser) for `payload` on write and read                      |

### `IssueOptions`

`{ role?: TRole; inviterRef?: string; inviteeRef?: string; payload?: TPayload; ttlMs?: number; expiresAt?: number }`

`inviterRef` and `inviteeRef` are opaque host subjects; omit `inviteeRef` for an
open link. `ttlMs` is ignored when `expiresAt` (absolute ms since the epoch) is
set. `role` and `payload` must be Convex values.

### `InvitationGrant`

`{ resourceRef: string; role?: TRole; payload?: TPayload }`, returned by
`accept`. The host writes its own membership from it.

### `InvitationView`

`{ token; resourceRef; role?; inviterRef?; inviteeRef?; payload?; state; createdAt; expiresAt; acceptedAt?; acceptedBy?; revokedAt? }`,
returned by `peek` and `getByToken`. `token` echoes the argument; times are ms
since the epoch. `acceptedAt`/`acceptedBy` are set once `accepted`, `revokedAt`
once `revoked`.

### `InvitationMetadata`

`InvitationView` without `token`, the row type of `listPending` and
`listByResourceState`.

### `InvitationState`

`"pending" | "accepted" | "revoked" | "expired"`. `pending` moves once to one of
the three terminal states; terminal states never change.

### `Parser`

`type Parser<T> = (value: unknown) => T`. Returns the typed value or throws. A
Zod schema's `.parse` fits; Convex `v.*` validators have no `.parse`, so wrap a
check in a function.

## Other entry points

### `convex.config`

```ts
// convex/convex.config.ts
import invitations from "@vllnt/convex-invitations/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(invitations);
export default app;
```

The default export is the component definition (`defineComponent("invitations")`).
`app.use(invitations, { name: "other" })` adds an independent mount with its own
table and crons, reached as `components.other`.

### `register`

`register<TSchema extends GenericSchema>(t: TestConvex<SchemaDefinition<TSchema, boolean>>, name = "invitations"): void`

From `@vllnt/convex-invitations/test`. Mounts the component in a `convex-test`
instance built from any host schema, under `name` (the mount name used in
`app.use`). The helper is shipped as TypeScript source and uses Vite's
`import.meta.glob`, so run it under Vitest with `convex-test`, `vite` and
`@edge-runtime/vm` installed.

### `ComponentApi`

From `@vllnt/convex-invitations/_generated/component` (types only). The
Convex-generated type of the mounted component's functions; it is what
`components.invitations` has in a host's `convex/_generated/api`.

## Error codes

Every component error is `ConvexError` with `data: { code, message }`; read
`error.data.code`.

| Code               | Thrown by                           | Meaning                                                                                                                                                             |
| ------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_TOKEN`    | `issue`, `accept`, `revoke`, `peek` | Token length is not 1 to 512 characters. `getByToken` returns `null` instead.                                                                                       |
| `INVALID_ARGUMENT` | `issue`, `accept`, `prune`          | Empty `resourceRef`/`inviterRef`/`inviteeRef`/`acceptedBy`; `expiresAt` not finite or not in the future (so a zero, negative or `NaN` `ttlMs`); `NaN` `before`/`retentionBefore`. |
| `INVALID_BATCH`    | `migrateLegacyTokens`, `prune`      | `batch` is not an integer from 1 to 100 (migration) or 1 to 500 (prune).                                                                                            |
| `DUPLICATE_TOKEN`  | `issue`                             | An invitation with this token already exists.                                                                                                                       |
| `NOT_FOUND`        | `accept`, `revoke`                  | No invitation has this token.                                                                                                                                       |
| `EXPIRED`          | `accept`                            | The invitation is `pending` but `expiresAt` has passed.                                                                                                             |
| `ALREADY_ACCEPTED` | `accept`, `revoke`                  | The invitation is already `accepted`.                                                                                                                               |
| `ALREADY_REVOKED`  | `accept`, `revoke`                  | The invitation is already `revoked`.                                                                                                                                |
| `ALREADY_EXPIRED`  | `accept`, `revoke`                  | The invitation is already stored as `expired`.                                                                                                                      |

## Cron and maintenance

The component registers two crons per mount (`src/component/crons.ts`):

| Job                                 | Cadence      | Action                                                                     |
| ----------------------------------- | ------------ | -------------------------------------------------------------------------- |
| `invitations:migrate-legacy-tokens` | every 24 hours | `migrateLegacyTokens` with the default batch (50), self-rescheduling      |
| `invitations:prune`                 | every 24 hours | `prune` with batch 200 and the default cutoffs (30-day retention)        |

Cadence and batch are module constants (`PRUNE_INTERVAL`, `PRUNE_BATCH`) and
cannot be changed by the host. Extra `prune` calls with other cutoffs run in
addition to the cron: a shorter retention works, a longer one does not, because
the cron still deletes terminal invitations 30 days after `createdAt`.

## Storage

One sandboxed table, `invitations`: `tokenHash` (SHA-256 hex digest), `token`
(raw token, only on rows not yet migrated), `resourceRef`, `role?`,
`inviterRef?`, `inviteeRef?`, `payload?`, `state`, `createdAt`, `expiresAt`,
`acceptedAt?`, `acceptedBy?`, `revokedAt?`. Indexes: `by_token_hash`,
`by_token`, `by_resource_state` (`resourceRef`, `state`, `createdAt`),
`by_state_expires` and `by_state_created`. The component touches no host
tables.
