import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
  PaginationOptions,
  PaginationResult,
} from "convex/server";
import type {
  InvitationGrant,
  InvitationState,
  InvitationView,
  InvitationsOptions,
  IssueOptions,
  Parser,
} from "./types.js";
import { DEFAULT_PRUNE_BATCH, DEFAULT_TTL_MS } from "../shared.js";

/**
 * The component's raw invitation view, before the client narrows opaque host
 * data. `role` and `payload` are `unknown` here; the {@link Invitations} client
 * runs the host validators over them at its typed boundary.
 */
type RawView = {
  token: string;
  resourceRef: string;
  role?: unknown;
  inviterRef?: string;
  inviteeRef?: string;
  payload?: unknown;
  state: InvitationState;
  createdAt: number;
  expiresAt: number;
  acceptedAt?: number;
  acceptedBy?: string;
  revokedAt?: number;
};

/** The component's raw accept grant, before the client narrows opaque host data. */
type RawGrant = { resourceRef: string; role?: unknown; payload?: unknown };

/**
 * The invitations component's function references, as exposed on the host via
 * `components.invitations`. The host's stored `role`/`payload` are opaque here
 * (`unknown`); the {@link Invitations} client narrows them at its own typed
 * boundary.
 */
export interface InvitationsComponent {
  mutations: {
    issue: FunctionReference<
      "mutation",
      "internal",
      {
        token: string;
        resourceRef: string;
        role?: unknown;
        inviterRef?: string;
        inviteeRef?: string;
        payload?: unknown;
        expiresAt: number;
      },
      { token: string; expiresAt: number }
    >;
    accept: FunctionReference<
      "mutation",
      "internal",
      { token: string; acceptedBy: string },
      RawGrant
    >;
    revoke: FunctionReference<
      "mutation",
      "internal",
      { token: string },
      null
    >;
    peek: FunctionReference<
      "mutation",
      "internal",
      { token: string },
      RawView | null
    >;
    prune: FunctionReference<
      "mutation",
      "internal",
      { before?: number; retentionBefore?: number; batch: number },
      number
    >;
  };
  queries: {
    getByToken: FunctionReference<
      "query",
      "internal",
      { token: string },
      RawView | null
    >;
    listPending: FunctionReference<
      "query",
      "internal",
      { resourceRef: string; paginationOpts: PaginationOptions },
      PaginationResult<RawView>
    >;
    listByResourceState: FunctionReference<
      "query",
      "internal",
      {
        resourceRef: string;
        state: InvitationState;
        paginationOpts: PaginationOptions;
      },
      PaginationResult<RawView>
    >;
  };
}

interface RunQueryCtx {
  runQuery<Q extends FunctionReference<"query", "internal">>(
    reference: Q,
    args: FunctionArgs<Q>,
  ): Promise<FunctionReturnType<Q>>;
}

interface RunMutationCtx {
  runMutation<M extends FunctionReference<"mutation", "internal">>(
    reference: M,
    args: FunctionArgs<M>,
  ): Promise<FunctionReturnType<M>>;
}

/**
 * Consumer-facing client for the invitation flow — issue → accept → expire. A
 * host mutation `issue`s an invitation to an opaque `resourceRef` (an org, a
 * team, a workspace) and gets back a single-use `token` to hand to the invitee
 * out of band (an email, a link); the invitee redeems it with `accept`, which
 * consumes the invite (single-use) and returns the grant the host applies. A
 * still-open invite can be `revoke`d, and an unaccepted invite `expire`s when
 * its TTL elapses (enforced on read and by a daily cron). The host owns meaning
 * and auth — it resolves identity, decides who may issue/accept, and passes
 * opaque `resourceRef`/`inviterRef`/`inviteeRef` refs plus arbitrary
 * `role`/`payload` data the component stores without inspecting. Pass
 * `roleValidator` / `payloadValidator` to narrow that opaque data to
 * `TRole` / `TPayload` at the boundary — there is no unchecked cast.
 *
 * At this minimal stage the invite (including its token) is modelled
 * self-contained; a later version would delegate the hashed/revocable token to
 * `@vllnt/convex-tokens` and write the granted membership via
 * `@vllnt/convex-memberships`, with `accept` composing the two.
 *
 * @typeParam TRole - The host's role type to grant on accept (defaults to `unknown`).
 * @typeParam TPayload - The host's opaque invite payload type (defaults to `unknown`).
 *
 * @example
 * ```ts
 * const invites = new Invitations(components.invitations, {
 *   ttlMs: 1000 * 60 * 60 * 24 * 3, // 3-day links
 *   roleValidator: v.union(v.literal("admin"), v.literal("member")).parse,
 * });
 * const { token } = await invites.issue(ctx, "org_42", { role: "member", inviterRef: me });
 * // ... invitee later redeems the link:
 * const grant = await invites.accept(ctx, token, invitee);
 * // host applies grant.resourceRef + grant.role (writes a membership)
 * ```
 */
export class Invitations<TRole = unknown, TPayload = unknown> {
  private readonly ttlMs: number;
  private readonly generateToken: () => string;
  private readonly roleValidator: Parser<TRole> | undefined;
  private readonly payloadValidator: Parser<TPayload> | undefined;

  constructor(
    private readonly component: InvitationsComponent,
    options: InvitationsOptions<TRole, TPayload> = {},
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.generateToken = options.generateToken ?? (() => crypto.randomUUID());
    this.roleValidator = options.roleValidator;
    this.payloadValidator = options.payloadValidator;
  }

  /** Narrow an opaque value through a host parser; pass `undefined` and unset parsers through. */
  private parse<T>(value: unknown, parser: Parser<T> | undefined): T | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (parser === undefined) {
      return value as T;
    }
    return parser(value);
  }

  /** Project a raw component view into the typed, validated client view. */
  private view(raw: RawView): InvitationView<TRole, TPayload> {
    return {
      token: raw.token,
      resourceRef: raw.resourceRef,
      role: this.parse(raw.role, this.roleValidator),
      inviterRef: raw.inviterRef,
      inviteeRef: raw.inviteeRef,
      payload: this.parse(raw.payload, this.payloadValidator),
      state: raw.state,
      createdAt: raw.createdAt,
      expiresAt: raw.expiresAt,
      acceptedAt: raw.acceptedAt,
      acceptedBy: raw.acceptedBy,
      revokedAt: raw.revokedAt,
    };
  }

  /** Project a raw accept grant into the typed, validated grant. */
  private grant(raw: RawGrant): InvitationGrant<TRole, TPayload> {
    return {
      resourceRef: raw.resourceRef,
      role: this.parse(raw.role, this.roleValidator),
      payload: this.parse(raw.payload, this.payloadValidator),
    };
  }

  /**
   * Issue an invitation to `resourceRef` and return the single-use `token` (to
   * hand to the invitee out of band) plus its absolute `expiresAt`. The token is
   * minted by `generateToken` (a UUID by default). Expiry resolves to
   * `opts.expiresAt` if given, else `now + (opts.ttlMs ?? the client default)`.
   * `role`/`payload` are validated against the host validators before storage.
   */
  async issue(
    ctx: RunMutationCtx,
    resourceRef: string,
    opts: IssueOptions<TRole, TPayload> = {},
  ): Promise<{ token: string; expiresAt: number }> {
    const token = this.generateToken();
    const expiresAt = opts.expiresAt ?? Date.now() + (opts.ttlMs ?? this.ttlMs);
    return ctx.runMutation(this.component.mutations.issue, {
      token,
      resourceRef,
      role: this.parse(opts.role, this.roleValidator),
      inviterRef: opts.inviterRef,
      inviteeRef: opts.inviteeRef,
      payload: this.parse(opts.payload, this.payloadValidator),
      expiresAt,
    });
  }

  /**
   * Redeem an invitation by its `token` for the opaque `acceptedBy` subject —
   * the single-use accept. Consumes the invite (transitions it to `accepted`)
   * and returns the grant the host applies (`resourceRef` + narrowed
   * `role`/`payload`). Rejects a missing, expired, or already-terminal invite
   * (the component throws a coded `ConvexError`); two racing accepts yield
   * exactly one winner.
   */
  async accept(
    ctx: RunMutationCtx,
    token: string,
    acceptedBy: string,
  ): Promise<InvitationGrant<TRole, TPayload>> {
    const raw = await ctx.runMutation(this.component.mutations.accept, {
      token,
      acceptedBy,
    });
    return this.grant(raw);
  }

  /** Revoke a still-`pending` invitation by its `token`. Rejects an already-terminal invite. */
  revoke(ctx: RunMutationCtx, token: string): Promise<null> {
    return ctx.runMutation(this.component.mutations.revoke, { token });
  }

  /**
   * The current view of one invitation by its `token`, or `null` if no such
   * invite is held — with read-time TTL enforcement: a `pending` invite found
   * past its `expiresAt` is flipped to `expired` and returned as such. Runs as a
   * mutation (it may write that one transition); use {@link getByToken} for a
   * pure reactive read.
   */
  async peek(
    ctx: RunMutationCtx,
    token: string,
  ): Promise<InvitationView<TRole, TPayload> | null> {
    const raw = await ctx.runMutation(this.component.mutations.peek, { token });
    return raw === null ? null : this.view(raw);
  }

  /**
   * Sweep stale `pending` invites to `expired` and delete terminal invites past
   * retention, in bounded batches oldest-first. `before` (the TTL cutoff) and
   * `retentionBefore` (the deletion cutoff) default to the server clock; `batch`
   * caps each pass and the sweep self-reschedules until the tail is clean.
   * Returns the count touched in the first pass. The built-in daily cron drives
   * this automatically.
   */
  prune(
    ctx: RunMutationCtx,
    opts: { before?: number; retentionBefore?: number; batch?: number } = {},
  ): Promise<number> {
    return ctx.runMutation(this.component.mutations.prune, {
      before: opts.before,
      retentionBefore: opts.retentionBefore,
      batch: opts.batch ?? DEFAULT_PRUNE_BATCH,
    });
  }

  /**
   * The current view of one invitation by its `token`, or `null` — a pure
   * reactive read (no write). Reports the stored `state` as-is, so a past-TTL
   * invite may still read `pending` until a `peek`/`accept`/cron sweep flips it;
   * compare `expiresAt` against the clock, or use {@link peek} for read-time TTL.
   */
  async getByToken(
    ctx: RunQueryCtx,
    token: string,
  ): Promise<InvitationView<TRole, TPayload> | null> {
    const raw = await ctx.runQuery(this.component.queries.getByToken, { token });
    return raw === null ? null : this.view(raw);
  }

  /**
   * Page the still-`pending` invitations for one `resourceRef`, oldest first.
   * Returns the standard Convex pagination envelope with each row narrowed to
   * the typed view.
   */
  async listPending(
    ctx: RunQueryCtx,
    resourceRef: string,
    paginationOpts: PaginationOptions,
  ): Promise<PaginationResult<InvitationView<TRole, TPayload>>> {
    const result = await ctx.runQuery(this.component.queries.listPending, {
      resourceRef,
      paginationOpts,
    });
    return { ...result, page: result.page.map((raw) => this.view(raw)) };
  }

  /**
   * Page invitations for one `resourceRef` in a given `state`, oldest first —
   * for an accepted/revoked/expired audit surface. Returns the standard Convex
   * pagination envelope with each row narrowed to the typed view.
   */
  async listByResourceState(
    ctx: RunQueryCtx,
    resourceRef: string,
    state: InvitationState,
    paginationOpts: PaginationOptions,
  ): Promise<PaginationResult<InvitationView<TRole, TPayload>>> {
    const result = await ctx.runQuery(
      this.component.queries.listByResourceState,
      { resourceRef, state, paginationOpts },
    );
    return { ...result, page: result.page.map((raw) => this.view(raw)) };
  }
}

export type {
  InvitationGrant,
  InvitationState,
  InvitationView,
  InvitationsOptions,
  IssueOptions,
  Parser,
};
