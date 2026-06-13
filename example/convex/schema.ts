import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * The example host app's own table. It is host-side state living entirely
 * outside the component's sandboxed `invitations` table — used to prove the
 * component never reaches into host tables (and the host never into the
 * component's, except through the exported client).
 *
 * It also models the real consumer pattern: on `accept` the host applies the
 * returned grant by writing a membership here. At this minimal stage that write
 * is the host's job; a later version would delegate it to
 * `@vllnt/convex-memberships`.
 */
export default defineSchema({
  memberships: defineTable({
    resourceRef: v.string(),
    subjectRef: v.string(),
    role: v.string(),
  }).index("by_resource_subject", ["resourceRef", "subjectRef"]),
});
