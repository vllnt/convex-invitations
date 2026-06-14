<!-- Badges -->
[![convex-component](https://img.shields.io/badge/convex-component-EE342F.svg)](https://www.convex.dev/components)
[![npm](https://img.shields.io/npm/v/@vllnt/convex-invitations.svg)](https://www.npmjs.com/package/@vllnt/convex-invitations)
[![CI](https://github.com/vllnt/convex-invitations/actions/workflows/ci.yml/badge.svg)](https://github.com/vllnt/convex-invitations/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@vllnt/convex-invitations.svg)](./LICENSE)

# @vllnt/convex-invitations

The invite → accept → expire flow, as a Convex component.

```ts
const invites = new Invitations(components.invitations);
const { token } = await invites.issue(ctx, orgId, { role: "member" }); // host delivers token
const grant = await invites.accept(ctx, token, userId); // single-use; host applies grant
```

A host mutation issues a single-use, expiring invitation to an opaque resource and
gets back a token to deliver out of band; the invitee redeems it with `accept`,
which consumes the invite and returns the grant the host applies. Domain-neutral: a
game guild invite, a SaaS workspace invite, a publication contributor invite.

## Features

- **Issue-and-deliver** — `issue` inserts a `pending` invite, returns a single-use `token` + `expiresAt`; the host delivers it (never sends email).
- **Single-use accept** — `accept` consumes the invite and returns the grant (`resourceRef` + opaque `role`/`payload`) the host applies.
- **Terminal states are final** — `accepted`/`revoked`/`expired` are terminal; a replayed link can never double-grant.
- **TTL + expiry** — every invite carries an `expiresAt`; accepting past-TTL is rejected; a daily cron and `peek` sweep stale invites.
- **Revoke** — `revoke` cancels a still-`pending` invite; a revoke racing an accept yields exactly one winner.
- **Poll or subscribe** — `getByToken`, `listPending`, and `listByResourceState` page invites reactively in Convex.
- **Typed, opaque host data** — `Invitations<TRole, TPayload>` with optional `roleValidator`/`payloadValidator` at the boundary; server-sourced time.
- **Bounded prune + cron, mount-safe** — a daily cron expires + prunes in idempotent batches; correct under multiple named mounts.

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
import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { Invitations } from "@vllnt/convex-invitations";

const invites = new Invitations<"admin" | "member", never>(components.invitations, {
  ttlMs: 1000 * 60 * 60 * 24 * 3, // 3-day links
  roleValidator: v.union(v.literal("admin"), v.literal("member")).parse,
});

// Issue: record the invite, return the token to deliver.
export const invite = mutation({
  args: { orgId: v.string(), role: v.union(v.literal("admin"), v.literal("member")) },
  handler: async (ctx, { orgId, role }) => {
    const { token } = await invites.issue(ctx, orgId, { role }); // host gates the caller first
    return { token }; // host emails `https://app/join?token=${token}`
  },
});

// Accept: consume the invite, apply the grant (write your own membership).
export const join = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const me = await currentUser(ctx); // host resolves identity
    const grant = await invites.accept(ctx, token, me);
    await ctx.db.insert("memberships", { orgId: grant.resourceRef, userId: me, role: grant.role });
  },
});
```

Client options: `new Invitations(component, { ttlMs?, generateToken?, roleValidator?, payloadValidator? })`.

## API Reference

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

Full reference: [docs/API.md](docs/API.md).

## React

Backend-only — no `./react` entry. An invite-management surface is an ordinary
reactive `useQuery` over the host's own re-exported `getByToken` / `listPending`
refs; the token is delivered by the host, never revealed in a client component.

## Security

- **Auth-agnostic** — the host authenticates the caller, decides who may issue/accept/revoke, and owns token delivery; tables are sandboxed.
- **Single-use + server-sourced time** — terminal states are final (no double-grant); TTL is enforced on read; timestamps come from `Date.now()`, never the caller.
- **Opaque host data** — `resourceRef`/`role`/`payload` are opaque, narrowed only by the optional host validators at the client boundary.

See [docs/API.md](docs/API.md).

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
