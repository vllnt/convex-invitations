import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query } from "./_generated/server";
import { invitationState, invitationView } from "./validators";
import type { Doc } from "./_generated/dataModel";

/** Project a stored invitation row to its public view (drops internal fields). */
function view(invite: Doc<"invitations">) {
  return {
    token: invite.token,
    resourceRef: invite.resourceRef,
    role: invite.role,
    inviterRef: invite.inviterRef,
    inviteeRef: invite.inviteeRef,
    payload: invite.payload,
    state: invite.state,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    acceptedAt: invite.acceptedAt,
    acceptedBy: invite.acceptedBy,
    revokedAt: invite.revokedAt,
  };
}

/**
 * The current view of one invitation by its `token`, or `null` if no such
 * invite is held. This is a pure read — it reports the stored `state` as-is and
 * does NOT flip a stale `pending` invite to `expired` (a query cannot write).
 * Read the `expiresAt`/`state` pair, or call the `peek` mutation when you need
 * read-time TTL enforcement.
 */
export const getByToken = query({
  args: { token: v.string() },
  returns: v.union(v.null(), invitationView),
  handler: async (ctx, args) => {
    const invite = await ctx.db
      .query("invitations")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    return invite === null ? null : view(invite);
  },
});

/**
 * Page the still-`pending` invitations for one `resourceRef`, oldest first via
 * the `by_resource_state` index. Takes the standard Convex `paginationOpts` and
 * returns the standard paginated envelope (`page`, `isDone`, `continueCursor`)
 * so the host can render an org's open-invite list reactively. Past-TTL invites
 * may still appear `pending` here until a `peek`/`accept`/cron sweep flips them;
 * compare `expiresAt` against the clock to hide stale ones in the host UI.
 */
export const listPending = query({
  args: { resourceRef: v.string(), paginationOpts: paginationOptsValidator },
  returns: v.object({
    page: v.array(invitationView),
    isDone: v.boolean(),
    continueCursor: v.string(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(
      v.union(
        v.literal("SplitRecommended"),
        v.literal("SplitRequired"),
        v.null(),
      ),
    ),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("invitations")
      .withIndex("by_resource_state", (q) =>
        q.eq("resourceRef", args.resourceRef).eq("state", "pending"),
      )
      .order("asc")
      .paginate(args.paginationOpts);
    return { ...result, page: result.page.map(view) };
  },
});

/**
 * Page invitations for one `resourceRef` in a given `state`, oldest first — the
 * general listing `listPending` specializes. Lets the host render accepted /
 * revoked / expired history for an audit surface.
 */
export const listByResourceState = query({
  args: {
    resourceRef: v.string(),
    state: invitationState,
    paginationOpts: paginationOptsValidator,
  },
  returns: v.object({
    page: v.array(invitationView),
    isDone: v.boolean(),
    continueCursor: v.string(),
    splitCursor: v.optional(v.union(v.string(), v.null())),
    pageStatus: v.optional(
      v.union(
        v.literal("SplitRecommended"),
        v.literal("SplitRequired"),
        v.null(),
      ),
    ),
  }),
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("invitations")
      .withIndex("by_resource_state", (q) =>
        q.eq("resourceRef", args.resourceRef).eq("state", args.state),
      )
      .order("asc")
      .paginate(args.paginationOpts);
    return { ...result, page: result.page.map(view) };
  },
});
