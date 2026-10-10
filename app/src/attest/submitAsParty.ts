import type { Address } from "viem";
import { requestGrant, type GrantResult } from "../app/app/grant/actions";
import { prepareWalletContext, type SwitchChain, type WalletContextConnector } from "./walletContext";

/// Readies the party's own wallet for a self-submitted transaction: right chain and account,
/// then the one-time starter gas grant, then the same check again because a grant can take long
/// enough for the wallet to have changed. A grant that isn't sent is not fatal (the wallet may
/// already hold gas), so it is reported to the caller and logged rather than thrown.
export async function prepareToSubmit(
  connector: WalletContextConnector | undefined,
  party: Address,
  chainId: number,
  switchChain: SwitchChain,
): Promise<GrantResult> {
  await prepareWalletContext(connector, party, chainId, switchChain);
  let grant: GrantResult;
  try {
    grant = await requestGrant();
  } catch (err) {
    grant = { ok: false, error: err instanceof Error ? err.message : "Starter grant request failed." };
  }
  if (!grant.ok) console.warn("Starter grant not sent; continuing with the wallet's own gas:", grant.error);
  await prepareWalletContext(connector, party, chainId, switchChain);
  return grant;
}
