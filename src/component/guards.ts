import { ConvexError } from "convex/values";

function invalidArgument(message: string): ConvexError<{ code: string; message: string }> {
  return new ConvexError({ code: "INVALID_ARGUMENT", message });
}

const MAX_REF_LENGTH = 256;

/** Reject an empty or over-long host-supplied reference (`resourceRef`, `acceptedBy`, ...). */
export function requireNonEmpty(name: string, value: string): void {
  if (value.length === 0) {
    throw invalidArgument(`${name} must not be empty`);
  }
  if (value.length > MAX_REF_LENGTH) {
    throw invalidArgument(`${name} must be at most ${String(MAX_REF_LENGTH)} characters`);
  }
}

/** Reject NaN and +/-Infinity where a concrete timestamp is required. */
export function requireFiniteTime(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw invalidArgument(`${name} must be a finite number`);
  }
}

/** Reject NaN; an infinite cutoff is a deliberate "everything" bound. */
export function requireNotNaN(name: string, value: number): void {
  if (Number.isNaN(value)) {
    throw invalidArgument(`${name} must not be NaN`);
  }
}
