import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";

export async function migrateLegacyToken(
  db: MutationCtx["db"],
  invite: Doc<"invitations">,
  tokenHash: string,
): Promise<Doc<"invitations">> {
  if (invite.token === undefined) return invite;
  await db.patch("invitations", invite._id, { tokenHash, token: undefined });
  return { ...invite, tokenHash, token: undefined };
}

export async function withLegacyTokenFallback(
  db: QueryCtx["db"],
  hashed: Doc<"invitations"> | null,
  token: string,
): Promise<Doc<"invitations"> | null> {
  if (hashed !== null) return hashed;
  return db
    .query("invitations")
    .withIndex("by_token", (query) => query.eq("token", token))
    .unique();
}
