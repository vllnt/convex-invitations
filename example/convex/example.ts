import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { Invitations } from "../../src/client";

/**
 * Host-app wrappers. The host owns auth: resolve identity here, then pass an
 * opaque `resourceRef` and opaque `role`/`payload`/`inviterRef`/`inviteeRef`
 * into the client. The single-use token is minted inside the component and
 * returned to the host to deliver out of band. Time is server-sourced inside
 * the component.
 */
const invites = new Invitations<string, { note: string }>(components.invitations);

/** A second client on the named `teamInvites` mount — proves mount-safe isolation. */
const teamInvites = new Invitations(components.teamInvites);

/**
 * A client with a host-supplied deterministic token generator — proves the
 * `generateToken` option and lets a test force a `DUPLICATE_TOKEN` collision.
 */
const fixedInvites = new Invitations(components.invitations, {
  generateToken: () => "fixed-token",
});

/**
 * A strict client that validates role and payload against host parsers — proves
 * the `roleValidator` / `payloadValidator` boundary on write and read.
 */
const strictInvites = new Invitations<"admin" | "member", { seats: number }>(
  components.invitations,
  {
    roleValidator: (value) => {
      if (value !== "admin" && value !== "member") {
        throw new Error("invalid role: expected 'admin' | 'member'");
      }
      return value;
    },
    payloadValidator: (value) => {
      if (
        typeof value !== "object" ||
        value === null ||
        typeof (value as { seats?: unknown }).seats !== "number"
      ) {
        throw new Error("invalid payload: expected { seats: number }");
      }
      return value as { seats: number };
    },
  },
);

const invitationView = v.object({
  token: v.string(),
  resourceRef: v.string(),
  role: v.optional(v.any()),
  inviterRef: v.optional(v.string()),
  inviteeRef: v.optional(v.string()),
  payload: v.optional(v.any()),
  state: v.union(
    v.literal("pending"),
    v.literal("accepted"),
    v.literal("revoked"),
    v.literal("expired"),
  ),
  createdAt: v.number(),
  expiresAt: v.number(),
  acceptedAt: v.optional(v.number()),
  acceptedBy: v.optional(v.string()),
  revokedAt: v.optional(v.number()),
});

const grant = v.object({
  resourceRef: v.string(),
  role: v.optional(v.any()),
  payload: v.optional(v.any()),
});

const paginated = v.object({
  page: v.array(invitationView),
  isDone: v.boolean(),
  continueCursor: v.string(),
  splitCursor: v.optional(v.union(v.string(), v.null())),
  pageStatus: v.optional(
    v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null()),
  ),
});

export const issue = mutation({
  args: {
    resourceRef: v.string(),
    role: v.optional(v.string()),
    inviterRef: v.optional(v.string()),
    inviteeRef: v.optional(v.string()),
    payload: v.optional(v.object({ note: v.string() })),
    ttlMs: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
  },
  returns: v.object({ token: v.string(), expiresAt: v.number() }),
  handler: (ctx, a) =>
    invites.issue(ctx, a.resourceRef, {
      role: a.role,
      inviterRef: a.inviterRef,
      inviteeRef: a.inviteeRef,
      payload: a.payload,
      ttlMs: a.ttlMs,
      expiresAt: a.expiresAt,
    }),
});

export const accept = mutation({
  args: { token: v.string(), acceptedBy: v.string() },
  returns: grant,
  handler: async (ctx, a) => {
    const g = await invites.accept(ctx, a.token, a.acceptedBy);
    // Apply the grant: write the host's own membership table (host glue — the
    // component never touches this table).
    await ctx.db.insert("memberships", {
      resourceRef: g.resourceRef,
      subjectRef: a.acceptedBy,
      role: typeof g.role === "string" ? g.role : "member",
    });
    return g;
  },
});

export const revoke = mutation({
  args: { token: v.string() },
  returns: v.null(),
  handler: (ctx, a) => invites.revoke(ctx, a.token),
});

export const peek = mutation({
  args: { token: v.string() },
  returns: v.union(v.null(), invitationView),
  handler: (ctx, a) => invites.peek(ctx, a.token),
});

export const getByToken = query({
  args: { token: v.string() },
  returns: v.union(v.null(), invitationView),
  handler: (ctx, a) => invites.getByToken(ctx, a.token),
});

export const listPending = query({
  args: { resourceRef: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginated,
  handler: (ctx, a) => invites.listPending(ctx, a.resourceRef, a.paginationOpts),
});

export const listByResourceState = query({
  args: {
    resourceRef: v.string(),
    state: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("revoked"),
      v.literal("expired"),
    ),
    paginationOpts: paginationOptsValidator,
  },
  returns: paginated,
  handler: (ctx, a) =>
    invites.listByResourceState(ctx, a.resourceRef, a.state, a.paginationOpts),
});

export const prune = mutation({
  args: {
    before: v.optional(v.number()),
    retentionBefore: v.optional(v.number()),
    batch: v.optional(v.number()),
  },
  returns: v.number(),
  handler: (ctx, a) =>
    invites.prune(ctx, {
      before: a.before,
      retentionBefore: a.retentionBefore,
      batch: a.batch,
    }),
});

/** Named-mount variants — prove a second instance is independent. */
export const issueTeam = mutation({
  args: { resourceRef: v.string() },
  returns: v.object({ token: v.string(), expiresAt: v.number() }),
  handler: (ctx, a) => teamInvites.issue(ctx, a.resourceRef),
});

export const getTeam = query({
  args: { token: v.string() },
  returns: v.union(v.null(), invitationView),
  handler: (ctx, a) => teamInvites.getByToken(ctx, a.token),
});

export const pruneTeam = mutation({
  args: {},
  returns: v.number(),
  handler: (ctx) => teamInvites.prune(ctx),
});

/** Fixed-token variant — deterministic token, used to force a duplicate collision. */
export const issueFixed = mutation({
  args: { resourceRef: v.string() },
  returns: v.object({ token: v.string(), expiresAt: v.number() }),
  handler: (ctx, a) => fixedInvites.issue(ctx, a.resourceRef),
});

/** Strict-client variants — exercise the role/payload validators. */
export const issueStrict = mutation({
  args: {
    resourceRef: v.string(),
    role: v.any(),
    payload: v.any(),
  },
  returns: v.object({ token: v.string(), expiresAt: v.number() }),
  handler: (ctx, a) =>
    strictInvites.issue(ctx, a.resourceRef, { role: a.role, payload: a.payload }),
});

export const acceptStrict = mutation({
  args: { token: v.string(), acceptedBy: v.string() },
  returns: grant,
  handler: (ctx, a) => strictInvites.accept(ctx, a.token, a.acceptedBy),
});

export const getStrict = query({
  args: { token: v.string() },
  returns: v.union(v.null(), invitationView),
  handler: (ctx, a) => strictInvites.getByToken(ctx, a.token),
});

/**
 * Host-side membership reader — reads the host's own `memberships` table,
 * completely outside the component's sandbox, proving host/component table
 * isolation.
 */
export const getMembership = query({
  args: { resourceRef: v.string(), subjectRef: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { resourceRef, subjectRef }) => {
    const row = await ctx.db
      .query("memberships")
      .withIndex("by_resource_subject", (q) =>
        q.eq("resourceRef", resourceRef).eq("subjectRef", subjectRef),
      )
      .unique();
    return row?.role ?? null;
  },
});
