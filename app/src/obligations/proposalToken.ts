/// The short token in a proposal link (`/app/o/<token>`). It's an unguessable handle, not the
/// access control: every read is still gated on the session being one of the two parties.

import { randomBytes } from "../netting/random";

const TOKEN_BYTES = 16;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function newProposalToken(): string {
  let binary = "";
  for (const byte of randomBytes(TOKEN_BYTES)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function isProposalToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}
