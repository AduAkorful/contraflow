/// Signing via Circle UCW — plans/22-circle-ucw-signing-method.md. **Corrected mid-implementation,
/// this session:** the first version of this file assumed `client.signTypedData()` returns a
/// signature directly, based on the client SDK's `signTypedData` method signature alone. Checked
/// further (Circle's actual REST reference for `POST /v1/w3s/user/sign/typedData`, not just the
/// Node SDK's own — possibly also generator-artifacted — types) and found it returns a
/// `challengeId`, same as every other PIN-gated operation in this API (`createUserPinWithWallets`,
/// etc.) — the real signature only exists after the *client* executes that challenge through
/// Circle's hosted PIN UI (`sdk.execute(challengeId, callback)`, whose `SignMessageResult.data.signature`
/// is genuinely typed as a plain string, unlike the server SDK's own visibly-wrong `Signature`
/// interface). There is no server-side "fetch the final signature" step at all — the browser
/// receives it directly in its own callback.

import { initiateUserControlledWalletsClient } from "@circle-fin/user-controlled-wallets";

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

export interface BeginSignTypedDataParams {
  walletId: string;
  userToken: string;
  /// The typed-data object exactly as `viem`'s `signTypedData` would take it (domain/types/message)
  /// — stringified here, since `SignTypedDataInput.data` is a JSON string, not an object.
  typedData: unknown;
}

/// Issues the sign challenge — the caller (browser) must execute the returned `challengeId` via
/// `@circle-fin/w3s-pw-web-sdk`'s `sdk.execute()` to actually obtain a signature; this function
/// never sees the signature itself.
export async function beginSignTypedData(params: BeginSignTypedDataParams): Promise<{ challengeId: string }> {
  const response = await client().signTypedData({
    walletId: params.walletId,
    userToken: params.userToken,
    data: JSON.stringify(params.typedData),
  });

  const data = response.data as unknown as { challengeId?: string } | undefined;
  if (!data?.challengeId) {
    throw new Error("beginSignTypedData: Circle did not return a challengeId");
  }
  return { challengeId: data.challengeId };
}
