import { ConvexError, v } from "convex/values";
import { api } from "./_generated/api";
import { mutation } from "./_generated/server";
import { invitationView, jsonValue } from "./validators";

/**
 * Issue an invitation to a `resourceRef` and return the single-use `token` the
 * host hands to the invitee (out of band — an email, a link). The invite is
 * inserted `pending` with `createdAt` stamped from the server clock and
 * `expiresAt` set from the caller-resolved TTL (the client computes it from
 * `ttlMs` or passes an absolute `expiresAt`).
 *
 * `token` is host-supplied (the client mints a random one) and must be unique —
 * re-using an existing token throws
 * `ConvexError({ code: "DUPLICATE_TOKEN" })` so a collision can never clobber an
 * open invite. `resourceRef`, `role`, `inviterRef`, `inviteeRef`, and `payload`
 * are opaque host data carried through to acceptance; the component never
 * inspects them.
 */
export const issue = mutation({
  args: {
    token: v.string(),
    resourceRef: v.string(),
    role: v.optional(jsonValue),
    inviterRef: v.optional(v.string()),
    inviteeRef: v.optional(v.string()),
    payload: v.optional(jsonValue),
    expiresAt: v.number(),
  },
  returns: v.object({ token: v.string(), expiresAt: v.number() }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("invitations")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (existing !== null) {
      throw new ConvexError({
        code: "DUPLICATE_TOKEN",
        message: `invitation token already exists`,
      });
    }

    await ctx.db.insert("invitations", {
      token: args.token,
      resourceRef: args.resourceRef,
      role: args.role,
      inviterRef: args.inviterRef,
      inviteeRef: args.inviteeRef,
      payload: args.payload,
      state: "pending",
      createdAt: Date.now(),
      expiresAt: args.expiresAt,
    });
    return { token: args.token, expiresAt: args.expiresAt };
  },
});

/**
 * Redeem an invitation by its `token` — the single-use accept transaction.
 * Atomically: the invite must exist, be `pending`, and not be past its
 * `expiresAt` as of the server clock. On success it transitions to `accepted`
 * (recording `acceptedAt` and the opaque `acceptedBy` subject) and returns the
 * grant the host applies — `resourceRef` + opaque `role`/`payload`. Because the
 * single check-and-patch runs in one mutation, two racing accepts yield exactly
 * one winner: the second sees a non-`pending` invite and is rejected.
 *
 * A `pending` invite found past its TTL is rejected with `EXPIRED` but NOT
 * flipped here — a thrown mutation rolls back its own writes, so the flip would
 * not persist. The non-throwing `peek` mutation and the prune cron sweep
 * `pending → expired` instead; the TTL is still enforced on read (the stale
 * invite can never be accepted).
 *
 * @throws `ConvexError({ code: "NOT_FOUND" })` when no invitation has `token`.
 * @throws `ConvexError({ code: "EXPIRED" })` when the invite's TTL has elapsed.
 * @throws `ConvexError({ code: "ALREADY_<STATE>" })` when the invite was already
 *   accepted, revoked, or expired (single-use — a terminal invite cannot be
 *   redeemed again).
 */
export const accept = mutation({
  args: { token: v.string(), acceptedBy: v.string() },
  returns: v.object({
    resourceRef: v.string(),
    role: v.optional(jsonValue),
    payload: v.optional(jsonValue),
  }),
  handler: async (ctx, args) => {
    const invite = await ctx.db
      .query("invitations")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (invite === null) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: `invitation not found`,
      });
    }
    if (invite.state !== "pending") {
      throw new ConvexError({
        code: `ALREADY_${invite.state.toUpperCase()}`,
        message: `invitation is already ${invite.state} and cannot be accepted`,
      });
    }

    const now = Date.now();
    if (invite.expiresAt <= now) {
      throw new ConvexError({
        code: "EXPIRED",
        message: `invitation expired`,
      });
    }

    await ctx.db.patch(invite._id, {
      state: "accepted",
      acceptedAt: now,
      acceptedBy: args.acceptedBy,
    });
    return {
      resourceRef: invite.resourceRef,
      role: invite.role,
      payload: invite.payload,
    };
  },
});

/**
 * Revoke a still-`pending` invitation by its `token`, transitioning it to
 * `revoked` (recording `revokedAt`). A revoked invite can never be accepted.
 * Already-terminal invites are rejected — revoking is itself a single
 * `pending → revoked` transition, so a revoke racing an accept yields one
 * winner.
 *
 * @throws `ConvexError({ code: "NOT_FOUND" })` when no invitation has `token`.
 * @throws `ConvexError({ code: "ALREADY_<STATE>" })` when the invite is already
 *   accepted, revoked, or expired.
 */
export const revoke = mutation({
  args: { token: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const invite = await ctx.db
      .query("invitations")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (invite === null) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: `invitation not found`,
      });
    }
    if (invite.state !== "pending") {
      throw new ConvexError({
        code: `ALREADY_${invite.state.toUpperCase()}`,
        message: `invitation is already ${invite.state} and cannot be revoked`,
      });
    }
    await ctx.db.patch(invite._id, { state: "revoked", revokedAt: Date.now() });
    return null;
  },
});

/**
 * The current view of one invitation by its `token`, or `null` if no such
 * invite is held. Lives in `mutations.ts` (not `queries.ts`) because it flips a
 * `pending` invite found past its TTL to `expired` before returning — the same
 * read-time TTL enforcement `accept` does, so a status check never reports a
 * stale invite as still open.
 */
export const peek = mutation({
  args: { token: v.string() },
  returns: v.union(v.null(), invitationView),
  handler: async (ctx, args) => {
    const invite = await ctx.db
      .query("invitations")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (invite === null) {
      return null;
    }
    if (invite.state === "pending" && invite.expiresAt <= Date.now()) {
      await ctx.db.patch(invite._id, { state: "expired" });
      return { ...view(invite), state: "expired" as const };
    }
    return view(invite);
  },
});

/**
 * Sweep up to `batch` invitations in two passes, oldest first. First — the
 * retention sweep — terminal invites whose `createdAt < retentionBefore` are
 * deleted (via `by_state_created` across `accepted`/`revoked`/`expired`). Then,
 * with whatever batch budget remains — the TTL sweep — `pending` invites whose
 * `expiresAt < before` are flipped to `expired` (via `by_state_expires`).
 *
 * Retention runs before TTL deliberately: a `pending` invite flipped to
 * `expired` this pass would otherwise re-qualify for the retention delete in the
 * same pass and be double-counted. Flipping last leaves the freshly-expired rows
 * for the NEXT pass (where `createdAt < retentionBefore` still holds), so each
 * invite is touched once per pass.
 *
 * `before` and `retentionBefore` default to the server clock. If a full batch
 * was touched there may be more, so the sweep self-reschedules through
 * `ctx.scheduler` until a short batch signals the tail is clean. Idempotent —
 * only ever deletes already-terminal, past-retention rows and expires
 * already-stale pending invites. Returns the total touched (deleted + expired)
 * in this pass. The built-in daily cron drives this automatically.
 */
export const prune = mutation({
  args: {
    before: v.optional(v.number()),
    retentionBefore: v.optional(v.number()),
    batch: v.number(),
  },
  returns: v.number(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const before = args.before ?? now;
    const retentionBefore = args.retentionBefore ?? now;

    // Retention sweep: the three terminal states, queried explicitly (no
    // query-in-loop), each consuming whatever batch budget the earlier passes
    // left.
    const accepted = await ctx.db
      .query("invitations")
      .withIndex("by_state_created", (q) =>
        q.eq("state", "accepted").lt("createdAt", retentionBefore),
      )
      .take(args.batch);
    const revoked =
      accepted.length < args.batch
        ? await ctx.db
            .query("invitations")
            .withIndex("by_state_created", (q) =>
              q.eq("state", "revoked").lt("createdAt", retentionBefore),
            )
            .take(args.batch - accepted.length)
        : [];
    const expired =
      accepted.length + revoked.length < args.batch
        ? await ctx.db
            .query("invitations")
            .withIndex("by_state_created", (q) =>
              q.eq("state", "expired").lt("createdAt", retentionBefore),
            )
            .take(args.batch - accepted.length - revoked.length)
        : [];
    for (const row of [...accepted, ...revoked, ...expired]) {
      await ctx.db.delete(row._id);
    }
    const removed = accepted.length + revoked.length + expired.length;

    // TTL sweep: flip stale pending invites with the remaining batch budget.
    const remaining = args.batch - removed;
    const stale =
      remaining > 0
        ? await ctx.db
            .query("invitations")
            .withIndex("by_state_expires", (q) =>
              q.eq("state", "pending").lt("expiresAt", before),
            )
            .take(remaining)
        : [];
    for (const row of stale) {
      await ctx.db.patch(row._id, { state: "expired" });
    }

    const touched = removed + stale.length;
    if (touched === args.batch) {
      await ctx.scheduler.runAfter(0, api.mutations.prune, {
        before,
        retentionBefore,
        batch: args.batch,
      });
    }
    return touched;
  },
});

/** Project a stored invitation row to its public view (drops internal fields). */
function view(invite: {
  token: string;
  resourceRef: string;
  role?: unknown;
  inviterRef?: string;
  inviteeRef?: string;
  payload?: unknown;
  state: "pending" | "accepted" | "revoked" | "expired";
  createdAt: number;
  expiresAt: number;
  acceptedAt?: number;
  acceptedBy?: string;
  revokedAt?: number;
}) {
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
