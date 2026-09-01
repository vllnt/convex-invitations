import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { register } from "../../src/test";
import crons, { PRUNE_BATCH, PRUNE_INTERVAL } from "../../src/component/crons";

const modules = import.meta.glob("./**/*.ts");

function setup() {
  const t = convexTest(schema, modules);
  register(t); // default "invitations" mount
  register(t, "teamInvites"); // second named mount — proves mount-safety
  return t;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("invitations — happy path (issue → accept → grant)", () => {
  test("issue → accept consumes the invite and returns the grant the host applies", async () => {
    const t = setup();
    const { token, expiresAt } = await t.mutation(api.example.issue, {
      resourceRef: "org_1",
      role: "member",
      inviterRef: "user_owner",
      inviteeRef: "user_invitee",
      payload: { note: "welcome" },
    });
    expect(typeof token).toBe("string");
    expect(expiresAt).toBe(604_800_000); // default 7-day TTL from t=0

    const pending = await t.query(api.example.getByToken, { token });
    expect(pending?.state).toBe("pending");
    expect(pending?.resourceRef).toBe("org_1");
    expect(pending?.role).toBe("member");
    expect(pending?.inviterRef).toBe("user_owner");
    expect(pending?.inviteeRef).toBe("user_invitee");
    expect(pending?.payload).toEqual({ note: "welcome" });
    expect(pending?.createdAt).toBe(0);

    vi.setSystemTime(1_000);
    const grant = await t.mutation(api.example.accept, {
      token,
      acceptedBy: "user_invitee",
    });
    expect(grant.resourceRef).toBe("org_1");
    expect(grant.role).toBe("member");
    expect(grant.payload).toEqual({ note: "welcome" });

    const accepted = await t.query(api.example.getByToken, { token });
    expect(accepted?.state).toBe("accepted");
    expect(accepted?.acceptedAt).toBe(1_000);
    expect(accepted?.acceptedBy).toBe("user_invitee");

    // the host applied the grant by writing its own membership table
    expect(
      await t.query(api.example.getMembership, {
        resourceRef: "org_1",
        subjectRef: "user_invitee",
      }),
    ).toBe("member");
  });

  test("issue with no role/payload defaults the host membership to 'member'", async () => {
    const t = setup();
    const { token } = await t.mutation(api.example.issue, { resourceRef: "org_x" });
    const invite = await t.query(api.example.getByToken, { token });
    expect(invite?.role).toBeUndefined();
    expect(invite?.payload).toBeUndefined();
    expect(invite?.inviterRef).toBeUndefined();
    await t.mutation(api.example.accept, { token, acceptedBy: "u" });
    expect(
      await t.query(api.example.getMembership, {
        resourceRef: "org_x",
        subjectRef: "u",
      }),
    ).toBe("member");
  });

  test("an absolute expiresAt overrides the default TTL", async () => {
    const t = setup();
    const { expiresAt } = await t.mutation(api.example.issue, {
      resourceRef: "org_1",
      expiresAt: 5_000,
    });
    expect(expiresAt).toBe(5_000);
  });

  test("a per-call ttlMs overrides the default TTL", async () => {
    const t = setup();
    vi.setSystemTime(100);
    const { expiresAt } = await t.mutation(api.example.issue, {
      resourceRef: "org_1",
      ttlMs: 1_000,
    });
    expect(expiresAt).toBe(1_100);
  });
});

describe("invitations — adversarial accept/revoke", () => {
  test("getByToken on a missing token returns null", async () => {
    const t = setup();
    expect(await t.query(api.example.getByToken, { token: "ghost" })).toBeNull();
  });

  test("accept on a missing token throws NOT_FOUND", async () => {
    const t = setup();
    await expect(
      t.mutation(api.example.accept, { token: "ghost", acceptedBy: "u" }),
    ).rejects.toThrow(/not found/);
  });

  test("revoke on a missing token throws NOT_FOUND", async () => {
    const t = setup();
    await expect(
      t.mutation(api.example.revoke, { token: "ghost" }),
    ).rejects.toThrow(/not found/);
  });

  test("a duplicate token throws DUPLICATE_TOKEN", async () => {
    const t = setup();
    // the fixed-token client always mints "fixed-token", so the second issue
    // collides — proving the uniqueness guard in `issue`.
    await t.mutation(api.example.issueFixed, { resourceRef: "o" });
    await expect(
      t.mutation(api.example.issueFixed, { resourceRef: "o" }),
    ).rejects.toThrow(/already exists/);
  });

  test("accepting an expired invite is rejected (a thrown accept does not flip; it stays pending until swept)", async () => {
    const t = setup();
    const { token } = await t.mutation(api.example.issue, {
      resourceRef: "org_1",
      ttlMs: 1_000,
    });
    vi.setSystemTime(2_000); // past the 1s TTL
    await expect(
      t.mutation(api.example.accept, { token, acceptedBy: "u" }),
    ).rejects.toThrow(/expired/);
    // the thrown accept rolled back any write — the row is still pending (a
    // peek or the cron persists the pending → expired sweep)
    expect((await t.query(api.example.getByToken, { token }))?.state).toBe(
      "pending",
    );
    // but it can never be accepted; the read-time check still rejects it
    await expect(
      t.mutation(api.example.accept, { token, acceptedBy: "u" }),
    ).rejects.toThrow(/expired/);
  });

  test("accepting an exactly-at-expiry invite is rejected (boundary: expiresAt <= now)", async () => {
    const t = setup();
    const { token } = await t.mutation(api.example.issue, {
      resourceRef: "org_1",
      expiresAt: 1_000,
    });
    vi.setSystemTime(1_000);
    await expect(
      t.mutation(api.example.accept, { token, acceptedBy: "u" }),
    ).rejects.toThrow(/expired/);
  });

  test("accepting an already-accepted invite is rejected (single-use)", async () => {
    const t = setup();
    const { token } = await t.mutation(api.example.issue, { resourceRef: "o" });
    await t.mutation(api.example.accept, { token, acceptedBy: "u1" });
    await expect(
      t.mutation(api.example.accept, { token, acceptedBy: "u2" }),
    ).rejects.toThrow(/already accepted/);
  });

  test("revoking a pending invite blocks acceptance", async () => {
    const t = setup();
    const { token } = await t.mutation(api.example.issue, { resourceRef: "o" });
    await t.mutation(api.example.revoke, { token });
    expect((await t.query(api.example.getByToken, { token }))?.state).toBe(
      "revoked",
    );
    await expect(
      t.mutation(api.example.accept, { token, acceptedBy: "u" }),
    ).rejects.toThrow(/already revoked/);
  });

  test("revoking an already-accepted invite is rejected", async () => {
    const t = setup();
    const { token } = await t.mutation(api.example.issue, { resourceRef: "o" });
    await t.mutation(api.example.accept, { token, acceptedBy: "u" });
    await expect(t.mutation(api.example.revoke, { token })).rejects.toThrow(
      /already accepted/,
    );
  });

  test("revoking an already-revoked invite is rejected", async () => {
    const t = setup();
    const { token } = await t.mutation(api.example.issue, { resourceRef: "o" });
    await t.mutation(api.example.revoke, { token });
    await expect(t.mutation(api.example.revoke, { token })).rejects.toThrow(
      /already revoked/,
    );
  });
});

describe("invitations — peek (read-time TTL enforcement)", () => {
  test("peek on a missing token returns null", async () => {
    const t = setup();
    expect(await t.mutation(api.example.peek, { token: "ghost" })).toBeNull();
  });

  test("peek flips a stale pending invite to expired and reports it", async () => {
    const t = setup();
    const { token } = await t.mutation(api.example.issue, {
      resourceRef: "o",
      ttlMs: 1_000,
    });
    vi.setSystemTime(2_000);
    const peeked = await t.mutation(api.example.peek, { token });
    expect(peeked?.state).toBe("expired");
    // the flip persisted
    expect((await t.query(api.example.getByToken, { token }))?.state).toBe(
      "expired",
    );
  });

  test("peek on a still-valid pending invite reports it unchanged", async () => {
    const t = setup();
    const { token } = await t.mutation(api.example.issue, {
      resourceRef: "o",
      ttlMs: 10_000,
    });
    const peeked = await t.mutation(api.example.peek, { token });
    expect(peeked?.state).toBe("pending");
  });

  test("peek on a terminal invite reports it unchanged", async () => {
    const t = setup();
    const { token } = await t.mutation(api.example.issue, { resourceRef: "o" });
    await t.mutation(api.example.accept, { token, acceptedBy: "u" });
    const peeked = await t.mutation(api.example.peek, { token });
    expect(peeked?.state).toBe("accepted");
  });
});

describe("invitations — concurrency (single winner)", () => {
  test("two racing accepts of the same invite yield exactly one winner", async () => {
    const t = setup();
    const { token } = await t.mutation(api.example.issue, { resourceRef: "o" });
    const results = await Promise.allSettled([
      t.mutation(api.example.accept, { token, acceptedBy: "a" }),
      t.mutation(api.example.accept, { token, acceptedBy: "b" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  test("a revoke racing an accept yields exactly one winner", async () => {
    const t = setup();
    const { token } = await t.mutation(api.example.issue, { resourceRef: "o" });
    const results = await Promise.allSettled([
      t.mutation(api.example.accept, { token, acceptedBy: "a" }),
      t.mutation(api.example.revoke, { token }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });
});

describe("invitations — listing (paginated)", () => {
  test("listPending pages a resource's open invites, oldest first", async () => {
    const t = setup();
    await t.mutation(api.example.issue, { resourceRef: "org_a" });
    vi.setSystemTime(10);
    const { token: t2 } = await t.mutation(api.example.issue, {
      resourceRef: "org_a",
    });
    vi.setSystemTime(20);
    await t.mutation(api.example.issue, { resourceRef: "org_a" });
    // a different resource is not listed
    await t.mutation(api.example.issue, { resourceRef: "org_b" });
    // accept one out of pending
    await t.mutation(api.example.accept, { token: t2, acceptedBy: "u" });

    const pending = await t.query(api.example.listPending, {
      resourceRef: "org_a",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(pending.page).toHaveLength(2);
    expect(pending.page.map((i) => i.createdAt)).toEqual([0, 20]);
    expect(pending.page.every((invite) => !("token" in invite))).toBe(true);
    expect(pending.isDone).toBe(true);
  });

  test("listPending respects the page size and returns a continue cursor", async () => {
    const t = setup();
    for (let i = 0; i < 3; i++) {
      vi.setSystemTime(i);
      await t.mutation(api.example.issue, { resourceRef: "org_p" });
    }
    const first = await t.query(api.example.listPending, {
      resourceRef: "org_p",
      paginationOpts: { cursor: null, numItems: 2 },
    });
    expect(first.page).toHaveLength(2);
    expect(first.isDone).toBe(false);
    const second = await t.query(api.example.listPending, {
      resourceRef: "org_p",
      paginationOpts: { cursor: first.continueCursor, numItems: 2 },
    });
    expect(second.page).toHaveLength(1);
    expect(second.isDone).toBe(true);
  });

  test("listByResourceState pages accepted history", async () => {
    const t = setup();
    const { token } = await t.mutation(api.example.issue, { resourceRef: "org_h" });
    await t.mutation(api.example.accept, { token, acceptedBy: "u" });
    const accepted = await t.query(api.example.listByResourceState, {
      resourceRef: "org_h",
      state: "accepted",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(accepted.page).toHaveLength(1);
    expect(accepted.page[0].state).toBe("accepted");
    expect("token" in accepted.page[0]).toBe(false);
    // an empty state returns a done empty page
    const revoked = await t.query(api.example.listByResourceState, {
      resourceRef: "org_h",
      state: "revoked",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    expect(revoked.page).toEqual([]);
    expect(revoked.isDone).toBe(true);
  });
});

describe("invitations — host role/payload validators (strict client)", () => {
  test("a valid role + payload round-trips through the strict client", async () => {
    const t = setup();
    const { token } = await t.mutation(api.example.issueStrict, {
      resourceRef: "org_s",
      role: "admin",
      payload: { seats: 5 },
    });
    const invite = await t.query(api.example.getStrict, { token });
    expect(invite?.role).toBe("admin");
    expect(invite?.payload).toEqual({ seats: 5 });
    const grant = await t.mutation(api.example.acceptStrict, {
      token,
      acceptedBy: "u",
    });
    expect(grant.role).toBe("admin");
    expect(grant.payload).toEqual({ seats: 5 });
  });

  test("a role failing the host validator is rejected before storage", async () => {
    const t = setup();
    await expect(
      t.mutation(api.example.issueStrict, {
        resourceRef: "o",
        role: "superuser",
        payload: { seats: 1 },
      }),
    ).rejects.toThrow(/invalid role/);
  });

  test("a payload failing the host validator is rejected before storage", async () => {
    const t = setup();
    await expect(
      t.mutation(api.example.issueStrict, {
        resourceRef: "o",
        role: "member",
        payload: { seats: "lots" },
      }),
    ).rejects.toThrow(/invalid payload/);
  });
});

describe("invitations — mount-safety (independent named mount)", () => {
  test("the two mounts hold independent invites and prune independently", async () => {
    const t = setup();
    const { token } = await t.mutation(api.example.issueTeam, {
      resourceRef: "team_1",
    });
    // the default mount does not see the team mount's invite
    expect(await t.query(api.example.getByToken, { token })).toBeNull();
    expect((await t.query(api.example.getTeam, { token }))?.resourceRef).toBe(
      "team_1",
    );
    expect(await t.mutation(api.example.pruneTeam, {})).toBe(0);
  });
});

describe("invitations — prune (TTL sweep + retention + self-reschedule)", () => {
  test("prune expires stale pending invites and deletes old terminal invites", async () => {
    const t = setup();
    // stale pending (will be expired by the TTL sweep)
    await t.mutation(api.example.issue, { resourceRef: "o", ttlMs: 1 });
    // old terminal (accepted then revoked) — deleted by the retention sweep
    const { token: acc } = await t.mutation(api.example.issue, { resourceRef: "o" });
    await t.mutation(api.example.accept, { token: acc, acceptedBy: "u" });
    const { token: rev } = await t.mutation(api.example.issue, { resourceRef: "o" });
    await t.mutation(api.example.revoke, { token: rev });
    // a fresh pending that must survive
    vi.setSystemTime(10_000);
    const { token: fresh } = await t.mutation(api.example.issue, {
      resourceRef: "o",
      ttlMs: 1_000_000,
    });

    const touched = await t.mutation(api.example.prune, {
      before: 5_000, // TTL cutoff — only the ttl=1 invite is past it
      retentionBefore: 5_000, // retention cutoff — the two terminal (created at 0) qualify
      batch: 200,
    });
    // 1 expired + 2 deleted
    expect(touched).toBe(3);
    expect((await t.query(api.example.getByToken, { token: fresh }))?.state).toBe(
      "pending",
    );
    expect(await t.query(api.example.getByToken, { token: acc })).toBeNull();
    expect(await t.query(api.example.getByToken, { token: rev })).toBeNull();
  });

  test("prune deletes expired (terminal) invites past retention too", async () => {
    const t = setup();
    const { token } = await t.mutation(api.example.issue, {
      resourceRef: "o",
      ttlMs: 1,
    });
    vi.setSystemTime(10);
    await t.mutation(api.example.peek, { token }); // flips it to expired
    expect((await t.query(api.example.getByToken, { token }))?.state).toBe(
      "expired",
    );
    // retention sweep removes the expired row (created at 0 < retentionBefore)
    const touched = await t.mutation(api.example.prune, {
      before: 100,
      retentionBefore: 100,
      batch: 200,
    });
    expect(touched).toBe(1);
    expect(await t.query(api.example.getByToken, { token })).toBeNull();
  });

  test("default prune retains terminal invitations for 30 days", async () => {
    const t = setup();
    const { token } = await t.mutation(api.example.issue, { resourceRef: "o" });
    await t.mutation(api.example.accept, { token, acceptedBy: "u" });

    vi.setSystemTime(30 * 24 * 60 * 60 * 1_000);
    expect(await t.mutation(api.example.prune, {})).toBe(0);
    expect(await t.mutation(api.example.peek, { token })).not.toBeNull();

    vi.setSystemTime(30 * 24 * 60 * 60 * 1_000 + 1);
    expect(await t.mutation(api.example.prune, {})).toBe(1);
    expect(await t.mutation(api.example.peek, { token })).toBeNull();
  });

  test.each([Number.NaN, 0, -1, 1.5, 501])("rejects invalid batch %s", async (batch) => {
    const t = setup();
    await expect(
      t.mutation(api.example.prune, { batch }),
    ).rejects.toThrow(/INVALID_BATCH|integer between/);
  });

  test("prune with no cutoffs defaults TTL to server now", async () => {
    const t = setup();
    await t.mutation(api.example.issue, { resourceRef: "o", ttlMs: 1 });
    vi.setSystemTime(1_000);
    // the pending invite is now past its TTL → expired by the default-now sweep
    expect(await t.mutation(api.example.prune, {})).toBe(1);
  });

  test("maintenance on an empty table returns 0", async () => {
    const t = setup();
    expect(await t.mutation(api.example.migrateLegacyTokens, {})).toBe(0);
    expect(
      await t.mutation(api.example.prune, {
        before: 9_999_999,
        retentionBefore: 9_999_999,
        batch: 200,
      }),
    ).toBe(0);
  });

  test("the TTL sweep alone fills the batch (retention pass is skipped)", async () => {
    const t = setup();
    await t.mutation(api.example.issue, { resourceRef: "o", ttlMs: 1 });
    await t.mutation(api.example.issue, { resourceRef: "o", ttlMs: 1 });
    vi.setSystemTime(10);
    // batch=2 entirely consumed by the two stale pendings → remaining = 0,
    // retention pass short-circuited; full batch → self-reschedule
    const firstPass = await t.mutation(api.example.prune, {
      before: 10,
      retentionBefore: 10,
      batch: 2,
    });
    expect(firstPass).toBe(2);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  });

  test("prune self-reschedules across a large terminal tail and clears it", async () => {
    const t = setup();
    const tokens: string[] = [];
    for (let i = 0; i < 5; i++) {
      const { token } = await t.mutation(api.example.issue, { resourceRef: "o" });
      await t.mutation(api.example.accept, { token, acceptedBy: `u${i}` });
      tokens.push(token);
    }
    vi.setSystemTime(1_000);
    const firstPass = await t.mutation(api.example.prune, {
      before: 1_000,
      retentionBefore: 1_000,
      batch: 2,
    });
    expect(firstPass).toBe(2);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    for (const token of tokens) {
      expect(await t.query(api.example.getByToken, { token })).toBeNull();
    }
  });

  test("prune fills a batch across accepted, revoked, and expired", async () => {
    const t = setup();
    const { token: a } = await t.mutation(api.example.issue, { resourceRef: "o" });
    await t.mutation(api.example.accept, { token: a, acceptedBy: "u" });
    const { token: r } = await t.mutation(api.example.issue, { resourceRef: "o" });
    await t.mutation(api.example.revoke, { token: r });
    const { token: e } = await t.mutation(api.example.issue, {
      resourceRef: "o",
      ttlMs: 1,
    });
    vi.setSystemTime(10);
    await t.mutation(api.example.peek, { token: e }); // → expired
    vi.setSystemTime(1_000);
    // batch=1 → first pass removes one accepted, self-reschedules for revoked+expired
    const firstPass = await t.mutation(api.example.prune, {
      before: 1_000,
      retentionBefore: 1_000,
      batch: 1,
    });
    expect(firstPass).toBe(1);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    for (const token of [a, r, e]) {
      expect(await t.query(api.example.getByToken, { token })).toBeNull();
    }
  });
});

describe("invitations — built-in prune cron", () => {
  test("registers a daily self-rescheduling prune job with the default page size", () => {
    expect(PRUNE_INTERVAL).toEqual({ hours: 24 });
    expect(PRUNE_BATCH).toBe(200);
    expect(Object.keys(crons.crons)).toContain("invitations:prune");
    expect(Object.keys(crons.crons)).toContain("invitations:migrate-legacy-tokens");
    const migration = crons.crons["invitations:migrate-legacy-tokens"];
    expect(migration?.name).toBe("mutations:migrateLegacyTokens");
    const job = crons.crons["invitations:prune"];
    expect(job?.name).toBe("mutations:prune");
    expect(job?.args).toEqual([{ batch: 200 }]);
  });
});

describe("invitations — host/component table isolation", () => {
  test("a host membership lives in the host table, separate from the component", async () => {
    const t = setup();
    const { token } = await t.mutation(api.example.issue, { resourceRef: "iso" });
    await t.mutation(api.example.accept, { token, acceptedBy: "member_1" });
    // the host membership is readable from the host table
    expect(
      await t.query(api.example.getMembership, {
        resourceRef: "iso",
        subjectRef: "member_1",
      }),
    ).toBe("member");
    // a membership with no component invite is fine — fully decoupled
    expect(
      await t.query(api.example.getMembership, {
        resourceRef: "iso",
        subjectRef: "ghost",
      }),
    ).toBeNull();
  });
});
