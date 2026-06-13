/** Public TypeScript surface for the invitations client. */

/** The four lifecycle states an invitation moves through. */
export type InvitationState = "pending" | "accepted" | "revoked" | "expired";

/**
 * Validates and narrows an opaque stored value to a host type `T` at the client
 * boundary. Receives the raw value the component returned (`unknown`) and MUST
 * return a typed `T` or throw. A `convex/values` validator's `.parse` (or a Zod
 * `.parse`) fits directly; omit it to keep the value unvalidated.
 *
 * @typeParam T - The host's stored type (invitation `role` or `payload`).
 */
export type Parser<T> = (value: unknown) => T;

/** The public view of one invitation returned by {@link Invitations.getByToken}. */
export interface InvitationView<TRole = unknown, TPayload = unknown> {
  /** The single-use secret naming this invitation. */
  token: string;
  /** The opaque host resource the invite grants access to (an org/team/workspace). */
  resourceRef: string;
  /** The opaque host role to grant on accept (narrowed if a `roleValidator` is set). */
  role?: TRole;
  /** The opaque host subject who issued the invite. */
  inviterRef?: string;
  /** The opaque host subject the invite is addressed to (open link when omitted). */
  inviteeRef?: string;
  /** Arbitrary opaque host data carried through to accept (narrowed if a `payloadValidator` is set). */
  payload?: TPayload;
  /** The current lifecycle state. */
  state: InvitationState;
  /** Absolute ms timestamp the invite was issued. */
  createdAt: number;
  /** Absolute ms timestamp the invite stops being acceptable. */
  expiresAt: number;
  /** Absolute ms timestamp of acceptance, present once `accepted`. */
  acceptedAt?: number;
  /** The opaque host subject who accepted, present once `accepted`. */
  acceptedBy?: string;
  /** Absolute ms timestamp of revocation, present once `revoked`. */
  revokedAt?: number;
}

/**
 * The grant {@link Invitations.accept} returns — what the host applies (writes a
 * membership, grants a role) once an invite is consumed. `role`/`payload` are
 * narrowed by the host validators when set.
 */
export interface InvitationGrant<TRole = unknown, TPayload = unknown> {
  /** The opaque host resource the accepted invite grants access to. */
  resourceRef: string;
  /** The opaque host role to grant (narrowed if a `roleValidator` is set). */
  role?: TRole;
  /** Arbitrary opaque host data carried from `issue` (narrowed if a `payloadValidator` is set). */
  payload?: TPayload;
}

/** Per-call options for {@link Invitations.issue}. */
export interface IssueOptions<TRole, TPayload> {
  /** The opaque host role to grant on accept (validated against `roleValidator` before storage). */
  role?: TRole;
  /** The opaque host subject issuing the invite. */
  inviterRef?: string;
  /** The opaque host subject the invite is addressed to; omit for an open link. */
  inviteeRef?: string;
  /** Arbitrary opaque host data carried through to accept (validated against `payloadValidator`). */
  payload?: TPayload;
  /** Override the client's default TTL for this invite (ms from issue). Ignored when `expiresAt` is set. */
  ttlMs?: number;
  /** An absolute expiry (ms epoch). Takes precedence over `ttlMs` and the default TTL. */
  expiresAt?: number;
}

/** Construction options for the {@link Invitations} client. */
export interface InvitationsOptions<TRole, TPayload> {
  /**
   * Default time-to-live (ms from issue) applied when an `issue` call passes
   * neither `ttlMs` nor an absolute `expiresAt`. Defaults to 7 days.
   */
  ttlMs?: number;
  /**
   * Mints the single-use token for a new invite. Defaults to `crypto.randomUUID`.
   * Supply a host generator for a different shape (a longer secret, a prefix).
   */
  generateToken?: () => string;
  /**
   * Validates/narrows a stored `role` to `TRole` at the boundary — applied to the
   * `role` passed into `issue` (before storage) and the `role` returned by
   * `getByToken`/`accept`. Throws on a mismatch. Omit to leave roles unvalidated.
   */
  roleValidator?: Parser<TRole>;
  /**
   * Validates/narrows a stored `payload` to `TPayload` at the boundary — applied
   * to the `payload` passed into `issue` and returned by `getByToken`/`accept`.
   * Throws on a mismatch. Omit to leave payloads unvalidated.
   */
  payloadValidator?: Parser<TPayload>;
}
