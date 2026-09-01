import { v } from "convex/values";

/**
 * Opaque host-owned data stored on an invitation — its `role` and its
 * `payload`. The component never inspects either; both are last-resort
 * arbitrary data, aliased here rather than left bare in function signatures.
 * The host narrows them at the {@link Invitations} client boundary via the
 * optional `roleValidator` / `payloadValidator` parsers.
 *
 * This is the single documented `v.any()` escape hatch in the component; the
 * lint rule `convex-rules/no-bare-v-any` is satisfied by routing every arbitrary
 * host payload through this alias instead of a bare `v.any()`.
 */
export const jsonValue = v.any();

/** The four lifecycle states an invitation moves through. */
export const invitationState = v.union(
  v.literal("pending"),
  v.literal("accepted"),
  v.literal("revoked"),
  v.literal("expired"),
);

/**
 * Public projection of an invitation returned by {@link getByToken} and
 * {@link listPending}. `resourceRef`, `inviterRef`, `inviteeRef`, `role`, and
 * `payload` are opaque host data — the component stores and returns them without
 * interpreting them. `token` is the single-use secret the host hands to the
 * invitee; the host gates who may read it.
 */
export const invitationMetadataView = v.object({
  resourceRef: v.string(),
  role: v.optional(jsonValue),
  inviterRef: v.optional(v.string()),
  inviteeRef: v.optional(v.string()),
  payload: v.optional(jsonValue),
  state: invitationState,
  createdAt: v.number(),
  expiresAt: v.number(),
  acceptedAt: v.optional(v.number()),
  acceptedBy: v.optional(v.string()),
  revokedAt: v.optional(v.number()),
});

export const invitationView = v.object({
  token: v.string(),
  resourceRef: v.string(),
  role: v.optional(jsonValue),
  inviterRef: v.optional(v.string()),
  inviteeRef: v.optional(v.string()),
  payload: v.optional(jsonValue),
  state: invitationState,
  createdAt: v.number(),
  expiresAt: v.number(),
  acceptedAt: v.optional(v.number()),
  acceptedBy: v.optional(v.string()),
  revokedAt: v.optional(v.number()),
});
