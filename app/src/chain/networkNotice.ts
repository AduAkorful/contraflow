import { ARC_TESTNET_CHAIN_ID } from "../contracts/addresses";

export const TEST_NETWORK_NOTICE = "Test network: no real funds";

/// Shown only while this app instance talks to Arc testnet. Mainnet deployments pass a
/// different chain id and get nothing, so the banner doesn't have to be remembered at launch.
export function testNetworkNotice(chainId: number): string | null {
  return chainId === ARC_TESTNET_CHAIN_ID ? TEST_NETWORK_NOTICE : null;
}
