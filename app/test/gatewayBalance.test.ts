import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { UnifiedBalanceChain } from "@circle-fin/app-kit";
import { resolveChainIdentifier } from "@circle-fin/adapter-viem-v2";

import {
  findGatewayChain,
  gatewayArcChain,
  gatewaySourceChains,
  networkTypeForChainId,
  unifiedBalanceEnabled,
  viemChainFor,
} from "../src/kits/gatewayChains";
import { checkUsdcAmount, confirmedOn, parseGatewayBalances, usdcFeeTotal } from "../src/kits/gatewayBalance";
import { isUnsupportedSmartAccount } from "../src/kits/browserAdapter";
import { ARC_MAINNET_CHAIN_ID, ARC_TESTNET_CHAIN_ID } from "../src/contracts/addresses";

const OWNER = "0x74B4134C8d527a8D8AE8cb9503ab2043bCfC0ffd" as const;
const OTHER = `0x${"22".repeat(20)}` as const;

describe("gateway source chains", () => {
  const all = [...gatewaySourceChains(ARC_TESTNET_CHAIN_ID), ...gatewaySourceChains(ARC_MAINNET_CHAIN_ID)];

  it("uses only chains the SDK's Unified Balance kit accepts, and never Arc or Solana", () => {
    const accepted = new Set<string>(Object.values(UnifiedBalanceChain));
    for (const c of all) {
      expect(accepted.has(c.chain), c.chain).toBe(true);
      expect(c.chain.startsWith("Arc")).toBe(false);
      expect(c.chain.startsWith("Solana")).toBe(false);
    }
  });

  it("matches the SDK's own chain id and USDC contract for every chain", () => {
    for (const c of all) {
      const def = resolveChainIdentifier(c.chain as never) as unknown as { chainId: number; usdcAddress: string };
      expect(c.chainId, c.chain).toBe(def.chainId);
      expect(c.usdcAddress.toLowerCase(), c.chain).toBe(def.usdcAddress.toLowerCase());
    }
  });

  it("covers every EVM Unified Balance chain apart from Arc", () => {
    const evm = Object.values(UnifiedBalanceChain).filter((v) => !v.startsWith("Arc") && !v.startsWith("Solana"));
    expect(all.map((c) => c.chain).sort()).toEqual([...evm].sort());
  });

  it("never mixes networks: testnets beside Arc Testnet, mainnets beside Arc", () => {
    expect(gatewaySourceChains(ARC_TESTNET_CHAIN_ID).every((c) => c.isTestnet)).toBe(true);
    expect(gatewaySourceChains(ARC_MAINNET_CHAIN_ID).every((c) => !c.isTestnet)).toBe(true);
    expect(networkTypeForChainId(ARC_TESTNET_CHAIN_ID)).toBe("testnet");
    expect(networkTypeForChainId(ARC_MAINNET_CHAIN_ID)).toBe("mainnet");
    expect(() => networkTypeForChainId(999999)).toThrow(/Unsupported Arc chain id 999999/);
  });

  it("resolves Arc itself from the SDK", () => {
    expect(gatewayArcChain(ARC_TESTNET_CHAIN_ID).chainId).toBe(ARC_TESTNET_CHAIN_ID);
    expect(gatewayArcChain(ARC_MAINNET_CHAIN_ID).chainId).toBe(ARC_MAINNET_CHAIN_ID);
  });

  it("builds wallet chain objects with the SDK's chain id", () => {
    const sepolia = findGatewayChain(ARC_TESTNET_CHAIN_ID, "Ethereum_Sepolia");
    expect(sepolia).toBeDefined();
    expect(viemChainFor(sepolia!).id).toBe(sepolia!.chainId);
  });
});

describe("unifiedBalanceEnabled", () => {
  it("is on for Arc Testnet unless switched off", () => {
    expect(unifiedBalanceEnabled(ARC_TESTNET_CHAIN_ID, undefined)).toBe(true);
    expect(unifiedBalanceEnabled(ARC_TESTNET_CHAIN_ID, "off")).toBe(false);
  });

  it("is off for Arc mainnet unless set to exactly `mainnet`", () => {
    expect(unifiedBalanceEnabled(ARC_MAINNET_CHAIN_ID, undefined)).toBe(false);
    expect(unifiedBalanceEnabled(ARC_MAINNET_CHAIN_ID, "on")).toBe(false);
    expect(unifiedBalanceEnabled(ARC_MAINNET_CHAIN_ID, "mainnet")).toBe(true);
    expect(unifiedBalanceEnabled(1, undefined)).toBe(false);
  });
});

describe("parseGatewayBalances", () => {
  const result = {
    totalConfirmedBalance: "3.396500",
    totalPendingBalance: "5.000000",
    breakdown: [
      {
        breakdown: [
          { chain: "Ethereum_Sepolia", confirmedBalance: "0.900000", pendingBalance: "5.000000" },
          { chain: "Base_Sepolia", confirmedBalance: "0.000000" },
          { chain: "Arc_Testnet", confirmedBalance: "2.496500" },
          { chain: "Some_Future_Chain", confirmedBalance: "1.000000" },
        ],
      },
      { breakdown: [{ chain: "Ethereum_Sepolia", confirmedBalance: "0.100000", pendingBalance: "garbage" }] },
    ],
  };

  it("sums per chain across depositor entries, drops empty chains, and sorts by confirmed", () => {
    const view = parseGatewayBalances(result, ARC_TESTNET_CHAIN_ID);
    expect(view.totalConfirmed).toBe("3.3965");
    expect(view.totalPending).toBe("5");
    expect(view.rows.map((r) => [r.chain, r.confirmed, r.pending])).toEqual([
      ["Arc_Testnet", "2.4965", "0"],
      ["Ethereum_Sepolia", "1", "5"],
      ["Some_Future_Chain", "1", "0"],
    ]);
  });

  it("marks which chains the page can act on", () => {
    const view = parseGatewayBalances(result, ARC_TESTNET_CHAIN_ID);
    expect(view.rows.find((r) => r.chain === "Ethereum_Sepolia")?.known?.name).toBe("Ethereum Sepolia");
    expect(view.rows.find((r) => r.chain === "Some_Future_Chain")?.known).toBeUndefined();
  });

  it("compares the response's Blockchain values with request chain names as strings", () => {
    const enumValued = { ...result, breakdown: [{ breakdown: [{ chain: UnifiedBalanceChain.Ethereum_Sepolia, confirmedBalance: "0.9" }] }] };
    expect(confirmedOn(enumValued, "Ethereum_Sepolia")).toBe(900_000n);
  });
});

describe("fees and amounts", () => {
  it("adds only USDC fees, never a deposit's native gas", () => {
    expect(
      usdcFeeTotal([
        { type: "provider", token: "USDC", amount: "0.000025" },
        { type: "gasFee", token: "USDC", amount: "1.099975" },
        { type: "forwarder", token: "USDC", amount: "0.020283" },
        { type: "gasFee", token: "ETH", amount: "0.000093348481327954" },
      ]),
    ).toBe(1_120_283n);
  });

  it.each([
    ["", false],
    ["abc", false],
    ["0", false],
    ["-1", false],
    ["1.1234567", false],
    ["1e3", false],
    ["25", true],
    ["25.5", true],
    [" 0.000001 ", true],
  ])("checks %j", (input, ok) => {
    expect(checkUsdcAmount(input).ok).toBe(ok);
  });

  it("refuses more than is available and normalises the amount", () => {
    expect(checkUsdcAmount("2", 1_500_000n)).toEqual({ ok: false, error: "That's more than the 1.5 USDC available." });
    expect(checkUsdcAmount("1.50", 1_500_000n)).toEqual({ ok: true, amount: "1.5", baseUnits: 1_500_000n });
  });
});

describe("isUnsupportedSmartAccount", () => {
  it("accepts plain and EIP-7702 delegated accounts, refuses contract wallets", () => {
    expect(isUnsupportedSmartAccount(undefined)).toBe(false);
    expect(isUnsupportedSmartAccount("0x")).toBe(false);
    expect(isUnsupportedSmartAccount(`0xef0100${"ab".repeat(20)}`)).toBe(false);
    expect(isUnsupportedSmartAccount("0x6080604052")).toBe(true);
  });
});

describe("useOwnerWallet", () => {
  const useAccount = vi.fn();
  vi.doMock("wagmi", () => ({ useAccount }));

  it("blocks when disconnected or connected as a different address than the session", async () => {
    const { useOwnerWallet } = await import("../src/app/app/balance/wallet");
    useAccount.mockReturnValue({ isConnected: false });
    expect(useOwnerWallet(OWNER).status).toBe("disconnected");

    useAccount.mockReturnValue({ isConnected: true, address: OTHER, connector: {} });
    expect(useOwnerWallet(OWNER)).toEqual({ status: "mismatch", connected: OTHER });

    useAccount.mockReturnValue({ isConnected: true, address: OWNER.toLowerCase(), connector: {} });
    expect(useOwnerWallet(OWNER).status).toBe("ready");
  });
});

describe("no deposit or move without a click", () => {
  const root = join(__dirname, "..");
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (name === "node_modules" || name.startsWith(".")) return [];
      return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  }
  const sources = [...files(join(root, "src/app")), ...files(join(root, "components"))].map((path) => ({
    path: relative(root, path),
    text: readFileSync(path, "utf8"),
  }));

  it("never imports the operator's server-side deposit or spend into the web app", () => {
    for (const { path, text } of sources) {
      expect(/\b(depositToGateway|spendOntoArc|fundResidualViaGateway)\b/.test(text), path).toBe(false);
    }
  });

  it("only the two panels call deposit/moveToArc, each from its own click handler, never from an effect", () => {
    const callers = sources.filter(({ text }) => /\b(deposit|moveToArc)\(await wallet\.adapter\(\)/.test(text));
    expect(callers.map((c) => c.path).sort()).toEqual(["src/app/app/balance/DepositPanel.tsx", "src/app/app/balance/MovePanel.tsx"]);
    for (const { path, text } of callers) {
      const handler = path.endsWith("DepositPanel.tsx") ? "handleDeposit" : "handleMove";
      const body = text.slice(text.indexOf(`async function ${handler}`));
      const call = path.endsWith("DepositPanel.tsx") ? "deposit(await wallet.adapter()" : "moveToArc(await wallet.adapter()";
      expect(text.indexOf(call), path).toBeGreaterThan(text.indexOf(`async function ${handler}`));
      expect(body.includes(call), path).toBe(true);
      expect(text.match(new RegExp(`onClick=\\{${handler}\\}`, "g"))?.length, path).toBe(1);
      for (const effect of text.split("useEffect(").slice(1)) {
        expect(/\b(deposit|moveToArc)\(/.test(effect.slice(0, effect.indexOf("}, ["))), path).toBe(false);
      }
    }
  });
});
