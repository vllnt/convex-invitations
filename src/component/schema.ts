import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { invitationState, jsonValue } from "./validators";

/**
 * Sandboxed table — the invitation's own concern. A `token` is a
 * component-minted single-use secret that names one invitation; the host hands
 * it to the invitee (out of band — email, link) and the invitee redeems it via
 * `accept`. `resourceRef` is the opaque host resource the invite grants access
 * to (an org, a team, a workspace); `role`/`payload` are opaque host data
 * carried through to the host on accept. `state` tracks the lifecycle and
 * `expiresAt` the TTL.
 *
 * Indexes serve token redemption/lookup (`by_token`), the pending-per-resource
 * listing (`by_resource_state`), the TTL expiry sweep over open invites
 * (`by_state_expires`), and the terminal retention sweep
 * (`by_state_created`, oldest-first).
 *
 * The component holds no membership and no real secret store at this minimal
 * stage — it models the invite self-contained. A later version would delegate
 * the hashed/revocable token to `@vllnt/convex-tokens` and write the granted
 * membership via `@vllnt/convex-memberships`; today the `token` lives here and
 * acceptance returns the grant to the host to apply.
 */
export default defineSchema({
  invitations: defineTable({
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
  })
    .index("by_token", ["token"])
    .index("by_resource_state", ["resourceRef", "state", "createdAt"])
    .index("by_state_expires", ["state", "expiresAt"])
    .index("by_state_created", ["state", "createdAt"]),
});
