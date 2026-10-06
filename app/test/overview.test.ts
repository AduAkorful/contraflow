import { describe, expect, it } from "vitest";
import { OVERVIEW_ILLUSTRATION_CAPTION } from "../components/overview/OverviewIllustration";
import { OVERVIEW_SECTION_ORDER } from "../components/overview/sections";
import { ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID } from "../src/contracts/addresses";
import { TEST_NETWORK_NOTICE, testNetworkNotice } from "../src/chain/networkNotice";
import { loopBannerTarget } from "../src/obligations/loopBanner";

describe("Overview sections", () => {
  it("lists signed-in sections in the accepted order", () => {
    expect([...OVERVIEW_SECTION_ORDER]).toEqual([
      "Your position",
      "Ready to net",
      "Waiting on you",
      "Recent activity",
      "Actions",
      "Network stats",
    ]);
  });

  it("labels the signed-out illustration", () => {
    expect(OVERVIEW_ILLUSTRATION_CAPTION).toBe("Example: an illustration, not a real transaction.");
  });
});

describe("NetworkNotice", () => {
  it("shows the test-network line only on testnet", () => {
    expect(testNetworkNotice(ARC_TESTNET_CHAIN_ID)).toBe(TEST_NETWORK_NOTICE);
    expect(testNetworkNotice(ARC_MAINNET_CHAIN_ID)).toBeNull();
  });
});

describe("loop banner target", () => {
  it("prefers a certificate the caller still needs to sign", () => {
    expect(
      loopBannerTarget(
        [
          { token: "a", status: "collecting", youSigned: true },
          { token: "b", status: "collecting", youSigned: false },
          { token: "c", status: "ready", youSigned: true },
        ],
        "found",
      ),
    ).toBe("b");
  });
});
