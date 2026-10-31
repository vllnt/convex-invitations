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

A host mutation issues a single-use, expiring invitation to an opaque resource
and gets back a token to deliver out of band; the invitee redeems it with
`accept`, which consumes the invite and returns the grant the host applies.
Domain-neutral: a game guild invite, a SaaS workspace invite, a publication
contributor invite.

## Features

- **Issue-and-deliver** — `issue` inserts a `pending` invite, returns a
  single-use `token` + `expiresAt`; the host delivers it (never sends email).
- **Single-use accept** — `accept` consumes the invite and returns the grant
  (`resourceRef` + opaque `role`/`payload`) the host applies.
- **Terminal states are final** — `accepted`/`revoked`/`expired` are terminal; a
  replayed link can never double-grant.
- **TTL + expiry** — every invite carries an `expiresAt`; accepting past-TTL is
  rejected; a daily cron and `peek` sweep stale invites.
- **Revoke** — `revoke` cancels a still-`pending` invite; a revoke racing an
  accept yields exactly one winner.
- **Poll or subscribe** — `getByToken` reads one invite; `listPending` and
  `listByResourceState` page token-free metadata reactively.
- **Typed, opaque host data** — `Invitations<TRole, TPayload>` with optional
  `roleValidator`/`payloadValidator` at the boundary; server-sourced time.
- **Bounded prune + cron, mount-safe** — a daily cron expires + prunes in
  idempotent batches; correct under multiple named mounts.

## Installation

```bash
pnpm add @vllnt/convex-invitations convex@^1.45.0
```

Peer dependency: `convex@^1.45.0`. The `canary` dist-tag tracks `main`.

## Quick start

After mounting, run `pnpm exec convex dev` to generate `components.invitations`.
These internal functions are for trusted server callers. Public wrappers must
authorize issuance, resolve the accepting identity, and apply the returned grant
in the same host mutation.

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
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { Invitations } from "@vllnt/convex-invitations";

const invites = new Invitations<"admin" | "member", never>(
  components.invitations,
  {
    ttlMs: 1000 * 60 * 60 * 24 * 3, // 3-day links
    roleValidator: (value) => {
      if (value !== "admin" && value !== "member")
        throw new Error("Invalid role");
      return value;
    },
  },
);

// Issue: record the invite, return the token to deliver.
export const invite = internalMutation({
  args: {
    orgId: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
  },
  handler: async (ctx, { orgId, role }) => {
    const { token } = await invites.issue(ctx, orgId, { role }); // host gates the caller first
    return { token }; // host emails `https://app/join?token=${token}`
  },
});

// Accept: return the grant to a trusted host mutation, which writes its membership.
export const accept = internalMutation({
  args: { token: v.string(), acceptedBy: v.string() },
  handler: (ctx, { token, acceptedBy }) =>
    invites.accept(ctx, token, acceptedBy),
});
```

Client options:
`new Invitations(component, { ttlMs?, generateToken?, roleValidator?, payloadValidator? })`.

## API Reference

| Method                                                         | Kind     | Result                                                                                               |
| -------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------- |
| `issue(ctx, resourceRef, opts?)`                               | mutation | `{ token, expiresAt }` (`opts`: `{ role?; inviterRef?; inviteeRef?; payload?; ttlMs?; expiresAt? }`) |
| `accept(ctx, token, acceptedBy)`                               | mutation | `InvitationGrant` (`{ resourceRef; role?; payload? }`)                                               |
| `revoke(ctx, token)`                                           | mutation | `null`                                                                                               |
| `peek(ctx, token)`                                             | mutation | `InvitationView \| null` (read-time TTL enforcement)                                                 |
| `getByToken(ctx, token)`                                       | query    | `InvitationView \| null` (pure reactive read)                                                        |
| `listPending(ctx, resourceRef, paginationOpts)`                | query    | `PaginationResult<InvitationMetadata>` (no token)                                                    |
| `listByResourceState(ctx, resourceRef, state, paginationOpts)` | query    | `PaginationResult<InvitationMetadata>` (no token)                                                    |
| `migrateLegacyTokens(ctx, batch?)`                             | mutation | `number` (rows migrated in the first pass)                                                           |
| `prune(ctx, opts?)`                                            | mutation | `number` (invites touched in the first bounded pass)                                                 |

Full reference: [docs/API.md](docs/API.md).

## Options and limitations

- Constructor options are `ttlMs` (default 7 days), `generateToken` (default
  `crypto.randomUUID`), and host parsers `roleValidator`/`payloadValidator`.
  Parsers return typed values or throw; Convex `v.*` validators do not have
  `.parse`.
- New rows store only a SHA-256 token digest. `issue` returns the raw token;
  `peek`/`getByToken` echo the token already supplied by the caller. Lists
  expose neither raw token nor digest and cannot recover a token for
  resend/revoke.
- Upgrading legacy storage: call `invites.migrateLegacyTokens(ctx)` from a
  trusted host mutation to hash/remove old raw tokens. Batch defaults to 50
  (integer 1–100), self-reschedules, and also runs daily; lookups remain
  compatible during migration.
- `getByToken` and list queries report stored state; expired links can still
  appear pending until `peek` or the cron expires them. `accept` rejects expiry
  without persisting a state change.
- `issue` rejects an empty `resourceRef`/`inviterRef`/`inviteeRef`, and an
  `expiresAt` that is not finite or not in the future (`INVALID_ARGUMENT`);
  `accept` rejects an empty `acceptedBy`. `getByToken` returns `null` for an
  empty or over-long token.
- `inviteeRef` is metadata, not an enforced recipient binding. The host must
  check recipient identity and resource permissions before acceptance.
- Terminal retention defaults to 30 days from `createdAt`, not acceptance time.
  Custom prune calls do not reconfigure the daily cron.
- Mount separately with `app.use(invitations, { name: "guestInvites" })` and
  `new Invitations(components.guestInvites)`.

## Integrations

Backend-only — no `./react` entry. An invite-management surface is an ordinary
reactive `useQuery` over the host's own re-exported `getByToken` / `listPending`
refs; the token is delivered by the host, never revealed in a client component.

## Security

- **Auth-agnostic** — the host authenticates the caller, decides who may
  issue/accept/revoke, and owns token delivery; tables are sandboxed.
- **Single-use + server-sourced time** — terminal states are final (no
  double-grant); TTL is enforced on read; timestamps come from `Date.now()`,
  never the caller.
- **Bearer tokens** — keep tokens out of logs and analytics, use secure
  delivery, and keep custom generators unpredictable. Hashing at rest does not
  protect a leaked link.
- **Opaque host data** — `resourceRef`/`role`/`payload` are opaque, narrowed
  only by the optional host validators at the client boundary.

See [docs/API.md](docs/API.md).

## Testing

```bash
pnpm test           # single run
pnpm test:coverage  # enforced 100% on covered files
```

Tests run against the real component runtime via `convex-test`
(`@edge-runtime/vm`), not mocks.

### Testing your app

`@vllnt/convex-invitations/test` exports `register(t, name = "invitations")` to
mount the component in a `convex-test` instance. It needs `convex-test` and
`vitest` (with Vite's `import.meta.glob`) in the consuming app:

```ts
/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { register } from "@vllnt/convex-invitations/test";
import schema from "./schema";

const t = convexTest(schema, import.meta.glob("./**/*.ts"));
register(t);
```

## Documentation

`llms.txt` is the maintained discovery index. `pnpm generate:llms` checks its
heading and local links without generating a source bundle.

[API reference](docs/API.md) · [LLM index](llms.txt) ·
[Security policy](SECURITY.md)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Author

Built by [bntvllnt](https://github.com/bntvllnt) ·
[bntvllnt.com](https://bntvllnt.com) · [X @bntvllnt](https://x.com/bntvllnt)

Part of the [@vllnt](https://github.com/vllnt) Convex component fleet —
[vllnt.com](https://vllnt.com)

If this is useful, [sponsor the work](https://github.com/sponsors/bntvllnt).

## License

MIT — see [LICENSE](LICENSE).
