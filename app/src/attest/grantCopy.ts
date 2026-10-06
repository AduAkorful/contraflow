import { ARC_TESTNET_CHAIN_ID } from "../contracts/addresses";

/// Shown when `requestGrant` actually funded the signed-in address.

export function starterGrantToast(amountUsdc: string, chainId: number): string {
  const test = chainId === ARC_TESTNET_CHAIN_ID ? " test" : "";
  return `We sent you ${amountUsdc}${test} USDC to cover network fees.`;
}
