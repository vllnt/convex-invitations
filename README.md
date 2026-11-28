# @vllnt/convex-invitations

TypeScript Convex component for single-use, expiring invitation links: issue,
accept once, revoke, expire and prune invites.

## For coding agents

Docs for the installed version are in `node_modules/@vllnt/convex-invitations/docs/`,
next to `llms.txt`, `CHANGELOG.md` and the TypeScript `src/`. Read them before
writing code against this package.

## When to use

- Use it when someone joins an org, team or workspace through a link that works
  once and expires.
- Use it when an open invite must be revocable and a replayed or concurrent
  accept must never grant twice.
- Do not use it when you need sign-in links, password resets or user accounts:
  use `@convex-dev/auth`.
- Do not use it when you need the invite email sent: it returns the token and
  sends nothing; use `@convex-dev/resend` or your own mailer.

## Install

```bash
pnpm add @vllnt/convex-invitations convex
```

## Quick start

```ts
// convex/convex.config.ts
import invitations from "@vllnt/convex-invitations/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(invitations);
export default app;
```

```ts
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  memberships: defineTable({
    orgId: v.string(),
    userRef: v.string(),
    role: v.union(v.literal("admin"), v.literal("member")),
  }).index("by_org_user", ["orgId", "userRef"]),
});
```

```ts
// convex/invites.ts
import { Invitations } from "@vllnt/convex-invitations";
import { ConvexError, v } from "convex/values";

import { components } from "./_generated/api";
import { mutation } from "./_generated/server";

type Role = "admin" | "member";
const role = v.union(v.literal("admin"), v.literal("member"));

const invites = new Invitations<Role>(components.invitations, {
  roleValidator: (value) => {
    if (value !== "admin" && value !== "member") throw new Error("bad role");
    return value;
  },
});

export const createInvite = mutation({
  args: { orgId: v.string(), role },
  returns: v.object({ token: v.string(), expiresAt: v.number() }),
  handler: async (ctx, args) => {
    const user = await ctx.auth.getUserIdentity();
    if (user === null) throw new ConvexError("not signed in");
    // Check here that `user` may invite people to `args.orgId`.
    return invites.issue(ctx, args.orgId, {
      role: args.role,
      inviterRef: user.tokenIdentifier,
    });
  },
});

export const acceptInvite = mutation({
  args: { token: v.string() },
  returns: v.object({ orgId: v.string(), role }),
  handler: async (ctx, { token }) => {
    const user = await ctx.auth.getUserIdentity();
    if (user === null) throw new ConvexError("not signed in");
    const grant = await invites.accept(ctx, token, user.tokenIdentifier);
    const membership = {
      orgId: grant.resourceRef,
      userRef: user.tokenIdentifier,
      role: grant.role ?? "member",
    };
    // Same mutation: if this write fails, the accept rolls back too.
    await ctx.db.insert("memberships", membership);
    return { orgId: membership.orgId, role: membership.role };
  },
});
```

Run `npx convex dev` once to generate `components.invitations`. Deliver the
returned `token` yourself (for example in a `https://example.com/join?token=<token>` link).
The component never reads auth: the host decides who may issue, accept and
revoke, and applies the returned grant.

## API

Full reference: [docs/API.md](docs/API.md).

| Export                                                                                             | Import from                                      | What it does                                                         |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| [`Invitations`](docs/API.md#invitations)                                                           | `@vllnt/convex-invitations`                      | Host client: `new Invitations(components.invitations, options?)`     |
| [`issue(ctx, resourceRef, opts?)`](docs/API.md#issue)                                              | `Invitations` method, mutation                   | Create a `pending` invite; returns `{ token, expiresAt }`            |
| [`accept(ctx, token, acceptedBy)`](docs/API.md#accept)                                             | `Invitations` method, mutation                   | Consume a `pending` invite once; returns the grant                   |
| [`revoke(ctx, token)`](docs/API.md#revoke)                                                         | `Invitations` method, mutation                   | `pending` -> `revoked`; returns `null`                               |
| [`peek(ctx, token)`](docs/API.md#peek)                                                             | `Invitations` method, mutation                   | Read one invite; stores `expired` if its TTL passed                  |
| [`getByToken(ctx, token)`](docs/API.md#getbytoken)                                                 | `Invitations` method, query                      | Read one invite as stored, or `null`                                 |
| [`listPending(ctx, resourceRef, paginationOpts)`](docs/API.md#listpending)                         | `Invitations` method, query                      | One page of `pending` invites for a resource, without tokens         |
| [`listByResourceState(ctx, resourceRef, state, paginationOpts)`](docs/API.md#listbyresourcestate) | `Invitations` method, query                      | One page of invites in one state for a resource, without tokens      |
| [`migrateLegacyTokens(ctx, batch?)`](docs/API.md#migratelegacytokens)                              | `Invitations` method, mutation                   | Replace stored raw tokens from older rows with digests               |
| [`prune(ctx, opts?)`](docs/API.md#prune)                                                           | `Invitations` method, mutation                   | Delete old terminal invites and expire stale `pending` ones          |
| [`InvitationsComponent`](docs/API.md#invitationscomponent)                                         | `@vllnt/convex-invitations` (type)               | Type of `components.invitations`                                     |
| [`InvitationsOptions`](docs/API.md#invitationsoptions)                                             | `@vllnt/convex-invitations` (type)               | `{ ttlMs?, generateToken?, roleValidator?, payloadValidator? }`      |
| [`IssueOptions`](docs/API.md#issueoptions)                                                         | `@vllnt/convex-invitations` (type)               | `{ role?, inviterRef?, inviteeRef?, payload?, ttlMs?, expiresAt? }`  |
| [`InvitationGrant`](docs/API.md#invitationgrant)                                                   | `@vllnt/convex-invitations` (type)               | Result of `accept`: `{ resourceRef, role?, payload? }`               |
| [`InvitationView`](docs/API.md#invitationview)                                                     | `@vllnt/convex-invitations` (type)               | Result of `peek` and `getByToken`                                    |
| [`InvitationMetadata`](docs/API.md#invitationmetadata)                                             | `@vllnt/convex-invitations` (type)               | List row: `InvitationView` without `token`                           |
| [`InvitationState`](docs/API.md#invitationstate)                                                   | `@vllnt/convex-invitations` (type)               | `"pending" \| "accepted" \| "revoked" \| "expired"`                  |
| [`Parser`](docs/API.md#parser)                                                                     | `@vllnt/convex-invitations` (type)               | `(value: unknown) => T`, used by `roleValidator`/`payloadValidator` |
| [`default` (component config)](docs/API.md#convexconfig)                                           | `@vllnt/convex-invitations/convex.config`        | Pass to `app.use(...)`                                               |
| [`register`](docs/API.md#register)                                                                 | `@vllnt/convex-invitations/test`                 | Mount the component in `convex-test`                                 |
| [`ComponentApi`](docs/API.md#componentapi)                                                         | `@vllnt/convex-invitations/_generated/component` | Generated type of the mounted component                              |

## Common tasks

Show an invite page before the user accepts. `getByToken` is a reactive query
that reports the stored state, so an expired link can still read `pending`;
compare `expiresAt` with the clock on the client:

```ts
// convex/invitePage.ts
import { Invitations } from "@vllnt/convex-invitations";
import { v } from "convex/values";

import { components } from "./_generated/api";
import { query } from "./_generated/server";

const invites = new Invitations(components.invitations);

export const invitePage = query({
  args: { token: v.string() },
  returns: v.union(
    v.null(),
    v.object({ orgId: v.string(), state: v.string(), expiresAt: v.number() }),
  ),
  handler: async (ctx, { token }) => {
    const invite = await invites.getByToken(ctx, token);
    if (invite === null) return null;
    return {
      orgId: invite.resourceRef,
      state: invite.state,
      expiresAt: invite.expiresAt,
    };
  },
});
```

List an org's open invites for an admin screen. List rows never include the
token, so keep the token yourself at `issue` time if you need to revoke or
resend from this screen:

```ts
// convex/openInvites.ts
import { Invitations } from "@vllnt/convex-invitations";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import { components } from "./_generated/api";
import { query } from "./_generated/server";

const invites = new Invitations(components.invitations);

export const openInvites = query({
  args: { orgId: v.string(), paginationOpts: paginationOptsValidator },
  returns: v.object({
    continueCursor: v.string(),
    isDone: v.boolean(),
    page: v.array(
      v.object({ inviteeRef: v.optional(v.string()), expiresAt: v.number() }),
    ),
  }),
  handler: async (ctx, { orgId, paginationOpts }) => {
    // Check here that the caller may see `orgId`'s invites.
    const result = await invites.listPending(ctx, orgId, paginationOpts);
    return {
      continueCursor: result.continueCursor,
      isDone: result.isDone,
      page: result.page.map((invite) => ({
        inviteeRef: invite.inviteeRef,
        expiresAt: invite.expiresAt,
      })),
    };
  },
});
```

Revoke an invite, and turn an accept failure into a result instead of an
exception. Errors are `ConvexError`s whose `data.code` is listed under
[Errors and fixes](#errors-and-fixes):

```ts
// convex/manageInvites.ts
import { Invitations } from "@vllnt/convex-invitations";
import { ConvexError, v } from "convex/values";

import { components } from "./_generated/api";
import { internalMutation, mutation } from "./_generated/server";

const invites = new Invitations(components.invitations);

export const revokeInvite = internalMutation({
  args: { token: v.string() },
  returns: v.null(),
  handler: (ctx, { token }) => invites.revoke(ctx, token),
});

const codeOf = (error: unknown): string | undefined => {
  if (!(error instanceof ConvexError)) return undefined;
  const data: unknown = error.data;
  if (typeof data !== "object" || data === null || !("code" in data)) {
    return undefined;
  }
  return typeof data.code === "string" ? data.code : undefined;
};

export const tryAccept = mutation({
  args: { token: v.string() },
  returns: v.object({ ok: v.boolean(), code: v.optional(v.string()) }),
  handler: async (ctx, { token }) => {
    const user = await ctx.auth.getUserIdentity();
    if (user === null) throw new ConvexError("not signed in");
    try {
      await invites.accept(ctx, token, user.tokenIdentifier);
      return { ok: true };
    } catch (error) {
      const code = codeOf(error);
      if (code === undefined) throw error;
      return { ok: false, code };
    }
  },
});
```

Keep terminal invites for less than the default 30 days by calling `prune`
from your own cron. The built-in daily cron still runs with 30 days, so a
longer window has no effect:

```ts
// convex/maintenance.ts
import { Invitations } from "@vllnt/convex-invitations";
import { v } from "convex/values";

import { components } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const invites = new Invitations(components.invitations);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const pruneAfterAWeek = internalMutation({
  args: {},
  returns: v.number(),
  handler: (ctx) =>
    invites.prune(ctx, { retentionBefore: Date.now() - WEEK_MS }),
});
```

```ts
// convex/crons.ts
import { cronJobs } from "convex/server";

import { internal } from "./_generated/api";

const crons = cronJobs();
crons.daily(
  "prune invitations after a week",
  { hourUTC: 3, minuteUTC: 0 },
  internal.maintenance.pruneAfterAWeek,
  {},
);
export default crons;
```

Mount the component twice. Each named mount has its own table and its own
crons, and shares nothing with the other:

```ts
// convex/convex.config.ts
import invitations from "@vllnt/convex-invitations/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(invitations);
app.use(invitations, { name: "guestInvites" });
export default app;
```

```ts
// convex/clients.ts
import { Invitations } from "@vllnt/convex-invitations";

import { components } from "./_generated/api";

export const teamInvites = new Invitations(components.invitations);
export const guestInvites = new Invitations(components.guestInvites, {
  ttlMs: 24 * 60 * 60 * 1000,
});
```

## Errors and fixes

Every component error is a `ConvexError` whose `data` is `{ code, message }`.
Catch it in the host with `error instanceof ConvexError` and read
`error.data.code`.

| Code               | Thrown by                                      | Cause                                                                                                                                                                  | Fix                                                                                                  |
| ------------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `INVALID_TOKEN`    | `issue`, `accept`, `revoke`, `peek`            | The token is empty or longer than 512 characters (for `issue`: what `generateToken` returned)                                                                          | Pass the token exactly as `issue` returned it; keep custom tokens 1 to 512 characters               |
| `INVALID_ARGUMENT` | `issue`, `accept`, `prune`                     | Empty `resourceRef`, `inviterRef`, `inviteeRef` or `acceptedBy`; `expiresAt` not finite or not in the future (also a zero, negative or `NaN` `ttlMs`); `NaN` `before` or `retentionBefore` | Pass non-empty refs (omit optional ones instead of `""`), a positive `ttlMs` or a future `expiresAt` |
| `INVALID_BATCH`    | `prune`, `migrateLegacyTokens`                 | `batch` is not an integer from 1 to 500 (`prune`) or 1 to 100 (`migrateLegacyTokens`)                                                                                  | Omit `batch` (defaults 200 and 50) or pass an integer in range                                       |
| `DUPLICATE_TOKEN`  | `issue`                                        | `generateToken` returned a token that an existing invite already uses                                                                                                  | Use an unpredictable generator such as the default `crypto.randomUUID`                               |
| `NOT_FOUND`        | `accept`, `revoke`                             | No invite has this token (never issued, mistyped, or already deleted by `prune`)                                                                                       | Show "invalid link"; `peek` and `getByToken` return `null` for the same case                         |
| `EXPIRED`          | `accept`                                       | The invite is still `pending` but `expiresAt` has passed                                                                                                               | Ask the inviter to issue a new invite                                                                |
| `ALREADY_ACCEPTED` | `accept`, `revoke`                             | The invite was already accepted (single use)                                                                                                                           | Treat a repeat accept by the same user as done; otherwise issue a new invite                        |
| `ALREADY_REVOKED`  | `accept`, `revoke`                             | The invite was revoked                                                                                                                                                 | Issue a new invite                                                                                   |
| `ALREADY_EXPIRED`  | `accept`, `revoke`                             | The invite's state was already set to `expired` by `peek` or `prune`                                                                                                   | Issue a new invite                                                                                   |

Arguments of the wrong type are rejected by Convex argument validation before
the component runs. An error thrown by your `roleValidator` or
`payloadValidator` is your own error and reaches the caller unchanged.

## Limits and gotchas

- Tokens are 1 to 512 characters (JavaScript string length). The default
  `generateToken` is `crypto.randomUUID()` (36 characters).
- New rows store only a SHA-256 digest of the token; older rows keep their raw
  token until `migrateLegacyTokens` or the daily cron hashes it. `issue`
  returns the raw token once; `peek` and `getByToken` echo the token you pass
  in, and the list queries return no token at all. Nothing can recover a lost
  token.
- `getByToken`, `listPending` and `listByResourceState` report the stored
  state: an invite past `expiresAt` reads `pending` until `peek` or the daily
  cron stores `expired`. `accept` rejects it with `EXPIRED` but does not store
  the change, because a throwing mutation rolls back its writes.
- `revoke` does not check `expiresAt`: a past-TTL invite still stored as
  `pending` becomes `revoked`.
- `accept` checks the state before the expiry, so a stored `expired` invite
  throws `ALREADY_EXPIRED`, and a stale `pending` one throws `EXPIRED`.
- `inviteeRef` is stored metadata only. `accept` does not compare it with
  `acceptedBy`; check the recipient yourself before calling `accept`.
- Default TTL is 7 days. `IssueOptions.expiresAt` wins over `ttlMs`, which wins
  over the client's `ttlMs`.
- Retention is 30 days counted from `createdAt`, not from acceptance or
  revocation. The built-in cron deletes accepted, revoked and expired invites
  older than that, so copy anything you must keep longer into your own table.
- Calling `prune` yourself does not change the built-in cron, which runs every
  24 hours with batch 200 and the default cutoffs. Each pass deletes and
  expires at most `batch` rows and schedules another pass when it used the whole
  batch. `prune` returns the count of the first pass only.
- `prune` `batch` is an integer from 1 to 500 (default 200).
  `migrateLegacyTokens` `batch` is an integer from 1 to 100 (default 50).
  `before` and `retentionBefore` accept `Infinity` but not `NaN`.
- List pages are ordered oldest first by `createdAt`. Page size comes from
  `paginationOpts.numItems`; the component adds no limit of its own.
- `role` and `payload` are stored as any Convex value. Your validators run on
  write and on every read, so a validator that rejects older stored values
  makes those reads throw.
- `accept` returns the grant; it writes nothing in your tables. Call it from a
  mutation and apply the grant in that same mutation. Called from an action,
  the accept and your write are separate transactions.
- Mutation-only methods (`issue`, `accept`, `revoke`, `peek`,
  `migrateLegacyTokens`, `prune`) need a `ctx` with `runMutation`; they cannot
  run in a query.
- The component sends nothing and reads no auth. Delivery, identity and
  permission checks belong to the host.

## Compatibility

- Peer dependency: `convex@^1.45.0`. This repository's unit tests run on the
  locked convex version; `pnpm test:package` type-checks the README examples
  and runs the Testing example against convex 1.45.0.
- Node.js: what your convex version needs. convex 1.45 to 1.48 declare
  `node >=20.0.0`; convex 1.49 and newer declare `node >=22.0.0`.
- Convex runtime: the component and the client use only the default Convex
  runtime (no Node.js actions). Named mounts with `app.use(invitations, { name })`
  are supported.
- ES modules only.
- `@vllnt/convex-invitations/test` needs `convex-test`, `vitest`, `vite` and
  `@edge-runtime/vm`. Add `vite` as a direct dev dependency: the
  `vite/client` types the helper references come from it.
- React: not applicable. The package is backend-only and has no `./react` entry;
  use `useQuery` on your own wrappers of `getByToken` or `listPending`.

## Testing

Mount the component in your own `convex-test` suite with `register(t)` from
`@vllnt/convex-invitations/test`. `t` can be built from your host schema. Use the
Vitest settings `convex-test` recommends:

```ts
// vitest.config.mts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
  },
});
```

```ts
// convex/invites.test.ts
/// <reference types="vite/client" />
import { register } from "@vllnt/convex-invitations/test";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

test("an invite works once", async () => {
  const t = convexTest(schema, import.meta.glob("./**/*.ts"));
  register(t);
  const owner = t.withIdentity({ tokenIdentifier: "owner" });
  const guest = t.withIdentity({ tokenIdentifier: "guest" });
  const { token } = await owner.mutation(api.invites.createInvite, {
    orgId: "org_1",
    role: "member",
  });
  const joined = await guest.mutation(api.invites.acceptInvite, { token });
  expect(joined).toEqual({ orgId: "org_1", role: "member" });
  await expect(
    guest.mutation(api.invites.acceptInvite, { token }),
  ).rejects.toThrow(/ALREADY_ACCEPTED/u);
});
```

`register(t, name)` takes the mount name when you used
`app.use(invitations, { name })`.

This repository's own tests run on the simulated `convex-test` runtime, not
mocks: `pnpm test:coverage` (100% coverage enforced).

## Security

- The component does not authenticate. The host authorizes every call and
  derives `inviterRef`, `acceptedBy` and the resource from its own auth; never
  take `acceptedBy` from the client.
- Tokens are bearer secrets: anyone holding the link can accept it. Keep them
  out of logs and analytics, deliver them over a secure channel, and keep a
  custom `generateToken` unpredictable. Hashing at rest does not protect a
  leaked link.
- Terminal states are final and every transition is one check-and-patch in one
  mutation, so racing accepts or an accept racing a revoke have one winner.
- `createdAt`, `acceptedAt` and `revokedAt` come from the server clock.
- The `invitations` table is reachable only through the component's functions.

Report vulnerabilities as described in
[SECURITY.md](https://github.com/vllnt/convex-invitations/blob/main/SECURITY.md).

## Related packages

No other `@vllnt` package is used with this one in code.

## Contributing

See
[CONTRIBUTING.md](https://github.com/vllnt/convex-invitations/blob/main/CONTRIBUTING.md).

## Links

- Docs and changelog: [oss.vllnt.com/packages/convex-invitations](https://oss.vllnt.com/packages/convex-invitations) · [release feed](https://oss.vllnt.com/packages/convex-invitations/rss.xml)
- All @vllnt packages: [oss.vllnt.com](https://oss.vllnt.com) · [search packages and docs on index.vllnt.com](https://index.vllnt.com)
- Source and issues: [GitHub](https://github.com/vllnt/convex-invitations) · [issues](https://github.com/vllnt/convex-invitations/issues) · [npm](https://www.npmjs.com/package/@vllnt/convex-invitations)
- Questions and updates: [Discord](https://bntvllnt.com/discord) · [X @bntvllnt](https://x.com/bntvllnt)
- Company and author: [vllnt.com](https://vllnt.com) · [bntvllnt.com](https://bntvllnt.com) · [GitHub @bntvllnt](https://github.com/bntvllnt) · [LinkedIn](https://linkedin.com/in/bntvllnt)
- Sponsor: [GitHub Sponsors](https://github.com/sponsors/bntvllnt)

## License

MIT. See [LICENSE](LICENSE).

[![npm version](https://img.shields.io/npm/v/@vllnt/convex-invitations.svg)](https://www.npmjs.com/package/@vllnt/convex-invitations)
[![CI status](https://github.com/vllnt/convex-invitations/actions/workflows/ci.yml/badge.svg)](https://github.com/vllnt/convex-invitations/actions/workflows/ci.yml)

---

Part of [vllnt open source](https://oss.vllnt.com) · [Package page](https://oss.vllnt.com/packages/convex-invitations) · [vllnt.com](https://vllnt.com) · Built by [bntvllnt](https://bntvllnt.com)
