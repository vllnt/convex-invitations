<!-- Badges -->
[![convex-component](https://img.shields.io/badge/convex-component-EE342F.svg)](https://www.convex.dev/components)
[![npm](https://img.shields.io/npm/v/@vllnt/convex-invitations.svg)](https://www.npmjs.com/package/@vllnt/convex-invitations)
[![CI](https://github.com/vllnt/convex-invitations/actions/workflows/ci.yml/badge.svg)](https://github.com/vllnt/convex-invitations/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@vllnt/convex-invitations.svg)](./LICENSE)

# @vllnt/convex-invitations

The invite → accept → expire flow, as a Convex component.

A host mutation issues a single-use, expiring invitation to an opaque resource (an
org, a team, a workspace) and gets back a token to hand to the invitee out of band
(an email, a link); the invitee redeems it with `accept`, which consumes the invite
(single-use) and returns the grant the host applies; a still-open invite can be
revoked, and an unaccepted invite expires when its TTL elapses. Domain-neutral: a
game party/guild invite, a SaaS workspace invite, a publication contributor invite —
any "invite a subject to a thing." The host owns the resource, the role meaning,
auth, and delivery; this component owns only the invitation envelope.

## Features

- **Issue-and-deliver** — `issue(resourceRef, { role?, inviterRef?, inviteeRef?, payload?, ttlMs? })` inserts a `pending` invite and returns a single-use `token` plus its absolute `expiresAt`; the host delivers the token (the component never sends email).
- **Single-use accept** — `accept(token, acceptedBy)` consumes the invite (transitions it to `accepted`) and returns the grant — `resourceRef` + opaque `role`/`payload` — that the host applies (writes a membership, grants a role). A consumed invite can never be redeemed again.
- **Terminal states are final** — an `accepted`, `revoked`, or `expired` invite is terminal; accepting or revoking it is rejected with a coded `ConvexError`, so a replayed link can never double-grant.
- **TTL + expiry** — every invite carries an `expiresAt` (from a configurable TTL or an absolute timestamp). Accepting a past-TTL invite is rejected; a daily cron (and the read-time `peek`) sweeps stale `pending` invites to `expired`.
- **Revoke** — `revoke(token)` cancels a still-`pending` invite. A revoke racing an accept yields exactly one winner.
- **Poll or subscribe** — `getByToken(token)` returns the current invite; `listPending(resourceRef, paginationOpts)` pages an org's open invites, and `listByResourceState` pages any state for an audit surface — reactively in Convex.
- **Typed, opaque host data** — `Invitations<TRole, TPayload>` types the stored `role`/`payload` end to end; pass `roleValidator`/`payloadValidator` to narrow the opaque values at the boundary (no unchecked cast, no `v.any()` dump). The component stores them opaquely.
- **Server-sourced time** — `createdAt`/`acceptedAt`/`revokedAt` are stamped from the server clock inside every handler; a caller can never supply a timestamp.
- **Bounded prune + cron** — a built-in daily cron expires stale `pending` invites and deletes terminal invites past a retention window, in bounded self-rescheduling batches; idempotent.
- **Mount-safe** — runs correctly under multiple named `app.use` mounts; each instance is an isolated sandbox.

## Architecture

```
src/
├── shared.ts              # constants (component name, states, TTL, retention, batch)
├── test.ts                # convex-test register() helper
├── client/                # Invitations class (the public API)
└── component/             # schema (invitations) + mutations + queries + prune cron
```

Sandboxed table: `invitations {token, resourceRef, role?, inviterRef?, inviteeRef?,
payload?, state, createdAt, expiresAt, acceptedAt?, acceptedBy?, revokedAt?}` —
indexed for token redemption (`by_token`), pending-per-resource listing
(`by_resource_state`), the TTL expiry sweep (`by_state_expires`), and the terminal
retention sweep (`by_state_created`). No host tables are touched. A built-in cron
(`crons.ts`) sweeps daily.

## Installation

```bash
pnpm add @vllnt/convex-invitations
```

Peer dependency: `convex@^1.41.0`.

## Usage

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import invitations from "@vllnt/convex-invitations/convex.config";

const app = defineApp();
app.use(invitations);
export default app;
```

```ts
// convex/invites.ts — host owns auth, the resource meaning, and delivery.
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Invitations } from "@vllnt/convex-invitations";

const invites = new Invitations<"admin" | "member", never>(
  components.invitations,
  {
    ttlMs: 1000 * 60 * 60 * 24 * 3, // 3-day links
    roleValidator: v.union(v.literal("admin"), v.literal("member")).parse,
  },
);

// 1) Issue: record the invite, return the token to deliver (email it, link it).
export const invite = mutation({
  args: { orgId: v.string(), role: v.union(v.literal("admin"), v.literal("member")) },
  handler: async (ctx, { orgId, role }) => {
    // host gates: may the caller invite to this org?
    const { token } = await invites.issue(ctx, orgId, { role });
    return { token }; // host emails `https://app/join?token=${token}`
  },
});

// 2) Accept: consume the invite, apply the grant (write your own membership).
export const join = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const me = await currentUser(ctx); // host resolves identity
    const grant = await invites.accept(ctx, token, me);
    await ctx.db.insert("memberships", {
      orgId: grant.resourceRef,
      userId: me,
      role: grant.role,
    });
  },
});

// 3) List an org's open invites (reactively, in a Convex query).
export const pending = query({
  args: { orgId: v.string(), paginationOpts: v.any() },
  handler: (ctx, { orgId, paginationOpts }) =>
    invites.listPending(ctx, orgId, paginationOpts),
});
```

## API Reference

See [docs/API.md](docs/API.md). Summary:

| Method | Kind | Result |
|--------|------|--------|
| `issue(ctx, resourceRef, opts?)` | mutation | `{ token, expiresAt }` (`opts`: `{ role?; inviterRef?; inviteeRef?; payload?; ttlMs?; expiresAt? }`) |
| `accept(ctx, token, acceptedBy)` | mutation | `InvitationGrant` (`{ resourceRef; role?; payload? }`) |
| `revoke(ctx, token)` | mutation | `null` |
| `peek(ctx, token)` | mutation | `InvitationView \| null` (read-time TTL enforcement) |
| `getByToken(ctx, token)` | query | `InvitationView \| null` (pure reactive read) |
| `listPending(ctx, resourceRef, paginationOpts)` | query | `PaginationResult<InvitationView>` |
| `listByResourceState(ctx, resourceRef, state, paginationOpts)` | query | `PaginationResult<InvitationView>` |
| `prune(ctx, opts?)` | mutation | `number` (invites touched in the first bounded pass) |

Client options:
`new Invitations(component, { ttlMs?, generateToken?, roleValidator?, payloadValidator? })`.
`prune` opts: `{ before?; retentionBefore?; batch? }` (defaults `before`/`retentionBefore = Date.now()`, `batch = 200`).

## React

This component ships **backend-only** — no `./react` entry. An invite-management
surface (an org's open-invite list) is an ordinary reactive `useQuery` over the
host's own re-exported `getByToken` / `listPending` function refs (those return live
in Convex), so a dedicated hook would add a wrapper with no value over the host's
existing `api`. The token is delivered by the host, not revealed in a client
component.

## Security Model

The component is **auth-agnostic**: it never authenticates or authorizes. The host
resolves identity, decides whether a caller may issue/accept/revoke an invite, and
owns delivery of the token. Component tables are sandboxed — the host reaches them
only through the exported functions, and the component never reads host or sibling
tables. `resourceRef`, `inviterRef`, `inviteeRef`, and the stored `role`/`payload`
are opaque to the component; it never inspects or de-references them.

**Single-use + terminal states are final**, so a replayed accept (or a duplicate
link) can never double-grant. **TTL is enforced on read** — accepting a
past-`expiresAt` invite is rejected even before the cron sweeps it. **Time is
server-sourced** — `createdAt`/`acceptedAt`/`revokedAt` come from `Date.now()` inside
each handler, never from the caller. The token is the bearer secret: the host gates
who may read it and delivers it out of band; it is stored as-is. The host may narrow the opaque
`role`/`payload` with `roleValidator` / `payloadValidator`, applied at the client
boundary on both write and read.

## Testing

```bash
pnpm test           # single run
pnpm test:coverage  # enforced 100% on covered files
```

Tests run against the real component runtime via `convex-test` (`@edge-runtime/vm`), not mocks.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Author

Built by [bntvllnt](https://github.com/bntvllnt) · [bntvllnt.com](https://bntvllnt.com) · [X @bntvllnt](https://x.com/bntvllnt)

Part of the [@vllnt](https://github.com/vllnt) Convex component fleet — [vllnt.com](https://vllnt.com)

If this is useful, [sponsor the work](https://github.com/sponsors/bntvllnt).

## License

MIT — see [LICENSE](LICENSE).
