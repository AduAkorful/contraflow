/// Hand-rolled EIP-4361 (Sign-In with Ethereum) message construction — no `siwe` npm package,
/// since that package's `.verify()` requires `ethers` internally and this project is viem-only.
/// The message format
/// itself is just a fixed string template (https://eips.ethereum.org/EIPS/eip-4361#message-format),
/// not complex logic — verification is done separately via viem, see `verifySignIn.ts`.

export interface SiweMessageParams {
  domain: string;
  address: `0x${string}`;
  statement: string;
  uri: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
}

/// EIP-4361 §"Message Format" — field order and blank lines are part of the spec, not stylistic.
export function buildSiweMessage(params: SiweMessageParams): string {
  return (
    `${params.domain} wants you to sign in with your Ethereum account:\n` +
    `${params.address}\n` +
    `\n` +
    `${params.statement}\n` +
    `\n` +
    `URI: ${params.uri}\n` +
    `Version: 1\n` +
    `Chain ID: ${params.chainId}\n` +
    `Nonce: ${params.nonce}\n` +
    `Issued At: ${params.issuedAt}\n` +
    `Expiration Time: ${params.expirationTime}`
  );
}
