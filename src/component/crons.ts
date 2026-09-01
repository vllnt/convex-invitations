import { cronJobs } from "convex/server";
import { api } from "./_generated/api";

/**
 * Default sweep cadence and page size for the built-in prune cron. The cron is
 * the component's own self-healing safety net — it expires stale `pending`
 * invites (so a never-accepted invite does not linger open forever) and deletes
 * terminal invites past retention. A host that wants a different cadence drives
 * `prune` from its own scheduler instead (the client exposes it).
 *
 * Convex cron definitions are static per deployment, so cadence is a documented
 * module constant rather than a mount-time option; the page size bounds each
 * sweep and `prune` self-reschedules until the tail is clean.
 */
export const PRUNE_INTERVAL = { hours: 24 } as const;

/** Rows touched per `prune` pass before the sweep self-reschedules. */
export const PRUNE_BATCH = 200;

const crons = cronJobs();

crons.interval(
  "invitations:migrate-legacy-tokens",
  PRUNE_INTERVAL,
  api.mutations.migrateLegacyTokens,
  {},
);

crons.interval("invitations:prune", PRUNE_INTERVAL, api.mutations.prune, {
  batch: PRUNE_BATCH,
});

export default crons;
