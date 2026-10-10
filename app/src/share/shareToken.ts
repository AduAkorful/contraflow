/// The short token in a share link (`/app/i/<token>`, `/app/o/<token>`, `/app/c/<token>`). It's an
/// unguessable handle, not the access control: every read is still gated on the session being
/// one of the parties.

import { randomBytes } from "../netting/random";

const TOKEN_BYTES = 16;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function newShareToken(): string {
  let binary = "";
  for (const byte of randomBytes(TOKEN_BYTES)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function isShareToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}
