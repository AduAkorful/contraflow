/// Random bytes from the platform CSPRNG. Throws rather than falling back to anything weaker:
/// blindings and link tokens are only as safe as their randomness.

export function randomBytes(length: number): Uint8Array {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") {
    throw new Error("crypto.getRandomValues is unavailable in this runtime");
  }
  return cryptoApi.getRandomValues(new Uint8Array(length));
}
