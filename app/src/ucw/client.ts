/// Circle User-Controlled Wallets — server-side half. Method names and input shapes below are
/// taken directly from `@circle-fin/user-controlled-wallets`'s compiled `.d.ts` files, not from
/// Circle's own quickstart doc, which showed a plausible but not fully accurate flow.

import { initiateUserControlledWalletsClient, HttpResponseError } from "@circle-fin/user-controlled-wallets";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name} — see app/.env.example`);
  return value;
}

let cached: ReturnType<typeof initiateUserControlledWalletsClient> | undefined;
function client() {
  if (!cached) {
    cached = initiateUserControlledWalletsClient({ apiKey: requireEnv("CIRCLE_API_KEY") });
  }
  return cached;
}

/// Creates the Circle end-user record for `userId` if it doesn't already exist. Circle returns a
/// 409 for an already-used `userId` (confirmed live this session by deliberately double-creating
/// the same id, not assumed) — treated as success here, since "the user already exists" is exactly
/// the outcome this function's caller wants, not a failure.
export async function ensureCircleUser(userId: string): Promise<void> {
  try {
    await client().createUser({ userId });
  } catch (err) {
    if (err instanceof HttpResponseError && err.status === 409) return;
    throw err;
  }
}

export interface UserSession {
  userToken: string;
  encryptionKey: string;
}

export async function issueUserToken(userId: string): Promise<UserSession> {
  const response = await client().createUserToken({ userId });
  if (!response.data?.userToken || !response.data.encryptionKey) {
    throw new Error("issueUserToken: Circle returned an incomplete session (missing userToken/encryptionKey)");
  }
  return { userToken: response.data.userToken, encryptionKey: response.data.encryptionKey };
}

/// Combined PIN-setup + wallet-creation challenge (one Circle call, not the two separate steps
/// Circle's own quickstart doc showed) — the client-side SDK must execute the returned
/// `challengeId` through the hosted PIN UI before the wallet actually exists.
export async function beginPinAndWalletSetup(userToken: string): Promise<{ challengeId: string }> {
  const response = await client().createUserPinWithWallets({ userToken, blockchains: ["ARC-TESTNET"] });
  if (!response.data?.challengeId) throw new Error("beginPinAndWalletSetup: Circle returned no challengeId");
  return { challengeId: response.data.challengeId };
}

/// The PIN+wallet-setup challenge's own completion callback only carries `{type, status}` (no
/// wallet details inline, per the client SDK's own `ChallengeResult` type) — the resulting wallet
/// is fetched separately, after a successful `execute()`, via this lookup.
export interface UcwWallet {
  id: string;
  address: string;
}

export async function firstUcwWallet(userToken: string): Promise<UcwWallet | null> {
  const response = await client().listWallets({ userToken });
  const wallet = response.data?.wallets?.[0];
  if (!wallet?.id || !wallet.address) return null;
  return { id: wallet.id, address: wallet.address };
}
