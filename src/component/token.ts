import { ConvexError } from "convex/values";

const encoder = new TextEncoder();
const MAX_TOKEN_LENGTH = 512;

export function validateToken(token: string): void {
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    throw new ConvexError({
      code: "INVALID_TOKEN",
      message: `token must be between 1 and ${MAX_TOKEN_LENGTH} characters`,
    });
  }
}

/** Deterministic SHA-256 digest used for bearer-token lookup without storing raw credentials. */
export async function tokenDigest(token: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
