import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { register } from "../../src/test";

// A host schema with only its own table — none of the component's tables and
// not the example app's schema. `register(t)` must accept it.
const hostSchema = defineSchema({
  hostNotes: defineTable({ label: v.string() }),
});
const modules = import.meta.glob("./**/*.ts");

test("register mounts the component on a host schema, under the default and a custom name", async () => {
  const t = convexTest(hostSchema, modules);
  register(t); // default "invitations" mount
  register(t, "teamInvites"); // custom name

  // The host's own table still works alongside the mounted component.
  await t.run(async (ctx) => {
    await ctx.db.insert("hostNotes", { label: "host-owned" });
  });

  const { token } = await t.mutation(api.example.issue, {
    resourceRef: "org_1",
  });
  const invite = await t.query(api.example.getByToken, { token });
  expect(invite?.state).toBe("pending");
  expect(invite?.resourceRef).toBe("org_1");

  const team = await t.mutation(api.example.issueTeam, {
    resourceRef: "team_1",
  });
  const teamInvite = await t.query(api.example.getTeam, { token: team.token });
  expect(teamInvite?.state).toBe("pending");
  expect(teamInvite?.resourceRef).toBe("team_1");

  // Each mount is its own sandbox.
  expect(
    await t.query(api.example.getByToken, { token: team.token }),
  ).toBeNull();
});
