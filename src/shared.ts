/** Shared constants used by both `client/` and `component/`. */

export const COMPONENT_NAME = "invitations";

/**
 * The invitation lifecycle states. `pending` is the freshly-issued, still-open
 * invite; it transitions exactly once into a terminal state — `accepted`
 * (consumed, single-use), `revoked` (cancelled by the host), or `expired`
 * (its TTL elapsed). Terminal states are final — a transition out of one is
 * rejected.
 */
export const INVITATION_STATES = [
  "pending",
  "accepted",
  "revoked",
  "expired",
] as const;

/** A single invitation lifecycle state. */
export type InvitationState = (typeof INVITATION_STATES)[number];

/** The three terminal states — once reached, an invitation never transitions again. */
export const TERMINAL_STATES: ReadonlySet<InvitationState> = new Set([
  "accepted",
  "revoked",
  "expired",
]);

/**
 * Default time-to-live (ms) for a freshly-issued invitation: 7 days. A
 * `pending` invite whose `expiresAt` is in the past can no longer be accepted
 * and is swept to `expired` by the prune cron. A host that wants a different
 * window passes `ttlMs` to the {@link Invitations} client (per call or as the
 * construction default), or an absolute `expiresAt` to `issue`.
 */
export const DEFAULT_TTL_MS = 604_800_000;

/**
 * Default retention (ms) for terminal invitations before the prune cron sweeps
 * them: 30 days. Bounds unbounded growth of the `invitations` table while
 * leaving a generous window for the host to audit accepted/revoked invites. A
 * host that wants a different window drives `prune` from its own scheduler with
 * an explicit `before` cutoff.
 */
export const DEFAULT_RETENTION_MS = 2_592_000_000;

/** Default page size for a `prune` pass before the sweep self-reschedules. */
export const DEFAULT_PRUNE_BATCH = 200;
