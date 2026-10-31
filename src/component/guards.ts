import { ConvexError } from "convex/values";

function invalidArgument(message: string): ConvexError<{ code: string; message: string }> {
  return new ConvexError({ code: "INVALID_ARGUMENT", message });
}

/** Reject an empty host-supplied reference (`resourceRef`, `acceptedBy`, ...). */
export function requireNonEmpty(name: string, value: string): void {
  if (value.length === 0) {
    throw invalidArgument(`${name} must not be empty`);
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
