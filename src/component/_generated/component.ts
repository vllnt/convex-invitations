/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    mutations: {
      issue: FunctionReference<
        "mutation",
        "internal",
        {
          expiresAt: number;
          inviteeRef?: string;
          inviterRef?: string;
          payload?: any;
          resourceRef: string;
          role?: any;
          token: string;
        },
        { expiresAt: number; token: string },
        Name
      >;
      accept: FunctionReference<
        "mutation",
        "internal",
        { acceptedBy: string; token: string },
        { payload?: any; resourceRef: string; role?: any },
        Name
      >;
      revoke: FunctionReference<
        "mutation",
        "internal",
        { token: string },
        null,
        Name
      >;
      peek: FunctionReference<
        "mutation",
        "internal",
        { token: string },
        null | {
          acceptedAt?: number;
          acceptedBy?: string;
          createdAt: number;
          expiresAt: number;
          inviteeRef?: string;
          inviterRef?: string;
          payload?: any;
          resourceRef: string;
          revokedAt?: number;
          role?: any;
          state: "pending" | "accepted" | "revoked" | "expired";
          token: string;
        },
        Name
      >;
      prune: FunctionReference<
        "mutation",
        "internal",
        { batch: number; before?: number; retentionBefore?: number },
        number,
        Name
      >;
    };
    queries: {
      getByToken: FunctionReference<
        "query",
        "internal",
        { token: string },
        null | {
          acceptedAt?: number;
          acceptedBy?: string;
          createdAt: number;
          expiresAt: number;
          inviteeRef?: string;
          inviterRef?: string;
          payload?: any;
          resourceRef: string;
          revokedAt?: number;
          role?: any;
          state: "pending" | "accepted" | "revoked" | "expired";
          token: string;
        },
        Name
      >;
      listPending: FunctionReference<
        "query",
        "internal",
        {
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          resourceRef: string;
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            acceptedAt?: number;
            acceptedBy?: string;
            createdAt: number;
            expiresAt: number;
            inviteeRef?: string;
            inviterRef?: string;
            payload?: any;
            resourceRef: string;
            revokedAt?: number;
            role?: any;
            state: "pending" | "accepted" | "revoked" | "expired";
            token: string;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        },
        Name
      >;
      listByResourceState: FunctionReference<
        "query",
        "internal",
        {
          paginationOpts: {
            cursor: string | null;
            endCursor?: string | null;
            id?: number;
            maximumBytesRead?: number;
            maximumRowsRead?: number;
            numItems: number;
          };
          resourceRef: string;
          state: "pending" | "accepted" | "revoked" | "expired";
        },
        {
          continueCursor: string;
          isDone: boolean;
          page: Array<{
            acceptedAt?: number;
            acceptedBy?: string;
            createdAt: number;
            expiresAt: number;
            inviteeRef?: string;
            inviterRef?: string;
            payload?: any;
            resourceRef: string;
            revokedAt?: number;
            role?: any;
            state: "pending" | "accepted" | "revoked" | "expired";
            token: string;
          }>;
          pageStatus?: "SplitRecommended" | "SplitRequired" | null;
          splitCursor?: string | null;
        },
        Name
      >;
    };
  };
