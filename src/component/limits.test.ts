/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");

function setup() {
  return convexTest(schema, modules);
}

const long = "x".repeat(257);
const max = "x".repeat(256);

function issueArgs(overrides: Record<string, string>) {
  return { token: "tok", resourceRef: "org", expiresAt: Date.now() + 60_000, ...overrides };
}

describe("host reference length caps", () => {
  test("256-character references are accepted on issue and accept", async () => {
    const t = setup();
    await t.mutation(api.mutations.issue, issueArgs({ resourceRef: max, inviterRef: max, inviteeRef: max }));
    expect(await t.mutation(api.mutations.accept, { token: "tok", acceptedBy: max })).toMatchObject({
      resourceRef: max,
    });
  });

  test.each(["resourceRef", "inviterRef", "inviteeRef"])("issue rejects a %s over 256 characters", async (field) => {
    const t = setup();
    await expect(t.mutation(api.mutations.issue, issueArgs({ [field]: long }))).rejects.toThrow(
      /at most 256 characters/,
    );
    expect(await t.run((ctx) => ctx.db.query("invitations").collect())).toHaveLength(0);
  });

  test("accept rejects an acceptedBy over 256 characters and leaves the invite pending", async () => {
    const t = setup();
    await t.mutation(api.mutations.issue, issueArgs({}));
    await expect(t.mutation(api.mutations.accept, { token: "tok", acceptedBy: long })).rejects.toThrow(
      /at most 256 characters/,
    );
    expect(await t.query(api.queries.getByToken, { token: "tok" })).toMatchObject({ state: "pending" });
  });
});
