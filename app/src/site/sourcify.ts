/// Sourcify's address lookup. The repo match pages 404 when a contract isn't a full match, so the
/// lookup hash is the link that always names the deployed address.
export function sourcifyLookupUrl(address: string): string {
  return `https://sourcify.dev/#/lookup/${address}`;
}
