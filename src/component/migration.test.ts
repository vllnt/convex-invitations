/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { tokenDigest } from "./token";

const modules = import.meta.glob("./**/*.ts");

function setup() {
  return convexTest(schema, modules);
}

async function seedLegacy(t: ReturnType<typeof setup>, token: string) {
  return t.run((ctx) =>
    ctx.db.insert("invitations", {
      token,
      resourceRef: "resource",
      state: "pending",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    }),
  );
}

test("new invitations persist only a token digest", async () => {
  const t = setup();
  const token = "new-secret";
  await t.mutation(api.mutations.issue, {
    token,
    resourceRef: "resource",
    expiresAt: Date.now() + 60_000,
  });
  const digest = await tokenDigest(token);
  const stored = await t.run((ctx) =>
    ctx.db
      .query("invitations")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", digest))
      .unique(),
  );
  expect(stored?.tokenHash).toBe(digest);
  expect(stored?.token).toBeUndefined();
});

test("accepting a legacy invitation removes the raw bearer token", async () => {
  const t = setup();
  const token = "legacy-accept";
  const id = await seedLegacy(t, token);
  await t.mutation(api.mutations.accept, { token, acceptedBy: "subject" });
  const stored = await t.run((ctx) => ctx.db.get("invitations", id));
  expect(stored?.token).toBeUndefined();
  expect(stored?.tokenHash).toBe(await tokenDigest(token));
  expect(stored?.state).toBe("accepted");
});

test("legacy lookup and duplicate detection work before background migration", async () => {
  const t = setup();
  const token = "legacy-lookup";
  await seedLegacy(t, token);
  expect((await t.query(api.queries.getByToken, { token }))?.resourceRef).toBe("resource");
  await expect(
    t.mutation(api.mutations.issue, {
      token,
      resourceRef: "other",
      expiresAt: Date.now() + 60_000,
    }),
  ).rejects.toThrow(/DUPLICATE_TOKEN|already exists/);
});

test("bounded migration hashes legacy tokens and self-drains", async () => {
  vi.useFakeTimers();
  try {
    const t = setup();
    const first = await seedLegacy(t, "");
    const second = await seedLegacy(t, "legacy-two");
    expect(await t.mutation(api.mutations.migrateLegacyTokens, { batch: 1 })).toBe(1);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    for (const id of [first, second]) {
      const stored = await t.run((ctx) => ctx.db.get("invitations", id));
      expect(stored?.token).toBeUndefined();
      expect(stored?.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    }
  } finally {
    vi.useRealTimers();
  }
});

test.each(["", "x".repeat(513)])("rejects invalid bearer token length", async (token) => {
  const t = setup();
  await expect(
    t.mutation(api.mutations.issue, {
      token,
      resourceRef: "resource",
      expiresAt: Date.now() + 60_000,
    }),
  ).rejects.toThrow(/INVALID_TOKEN|between 1 and 512/);
  await expect(t.query(api.queries.getByToken, { token })).rejects.toThrow(
    /INVALID_TOKEN|between 1 and 512/,
  );
});

test.each([Number.NaN, 0, -1, 1.5, 101])(
  "legacy migration rejects invalid batch %s",
  async (batch) => {
    const t = setup();
    await expect(
      t.mutation(api.mutations.migrateLegacyTokens, { batch }),
    ).rejects.toThrow(/INVALID_BATCH|integer between/);
  },
);
