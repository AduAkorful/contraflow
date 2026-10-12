/// Free-text fields (obligation and invoice descriptions) are stored as JSON text. Postgres
/// can't hold a NUL in text or jsonb, and other control characters corrupt copy and display, so
/// they're refused up front with a clear message instead of failing inside the database.

// Tab, newline and carriage return are ordinary in pasted text and stay allowed.
const DISALLOWED_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export function descriptionTextProblem(text: string): string | null {
  return DISALLOWED_CONTROL.test(text) ? "The description can't contain control characters" : null;
}

/// The longest description an invoice or obligation may carry, in characters.
export const MAX_DESCRIPTION_LENGTH = 500;
