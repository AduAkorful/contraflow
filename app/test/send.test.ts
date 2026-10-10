import { describe, expect, it } from "vitest";
import { decodeFunctionData, parseAbi } from "viem";
import { ARC_TESTNET_CHAIN_ID, addressesForChain } from "../src/contracts/addresses";
import {
  checkRecipient,
  checkSendAmount,
  clearPendingSend,
  encodeTransfer,
  feeInBaseUnits,
  maxSendable,
  readPendingSend,
  reservedFee,
  savePendingSend,
  transferFailureMessage,
} from "../src/send/transfer";

const SENDER = "0x4e71B023324BB2F66Fe3E4153BC4b40Fb913b24F";
const OTHER = "0x3EB62da85e00c34D418818df3831e984854F689B";
const CHAIN = ARC_TESTNET_CHAIN_ID;

describe("send amounts", () => {
  it("rounds the fee up to a 6-decimal unit", () => {
    // 49,097 gas at 25 gwei = 1,227,425 gwei = 0.001227425 USDC -> 1228 base units rounded up
    expect(feeInBaseUnits(49_097n, 25_000_000_000n)).toBe(1_228n);
    expect(feeInBaseUnits(1n, 1n)).toBe(1n);
    expect(feeInBaseUnits(0n, 5n)).toBe(0n);
  });

  it("reserves double the estimate and never goes below zero", () => {
    expect(reservedFee(1_228n)).toBe(2_456n);
    expect(maxSendable(10_000_000n, 1_228n)).toBe(10_000_000n - 2_456n);
    expect(maxSendable(2_000n, 1_228n)).toBe(0n);
  });

  it("accepts an amount that leaves room for the fee", () => {
    expect(checkSendAmount("1.50", 10_000_000n, 1_228n)).toEqual({ ok: true, amount: 1_500_000n });
  });

  it("refuses zero, malformed, over-precise and over-balance amounts", () => {
    for (const bad of ["0", "-1", "1e3", "1.1234567", "abc", ""]) {
      expect(checkSendAmount(bad, 10_000_000n, 1_228n).ok).toBe(false);
    }
    expect(checkSendAmount("11", 10_000_000n, 1_228n)).toMatchObject({ ok: false });
  });

  it("refuses an amount that would leave nothing for the fee", () => {
    const result = checkSendAmount("9.999999", 10_000_000n, 1_228n);
    expect(result).toMatchObject({ ok: false });
  });

  it("refuses while the balance or fee isn't known", () => {
    expect(checkSendAmount("1", null, 1_228n).ok).toBe(false);
    expect(checkSendAmount("1", 10_000_000n, null).ok).toBe(false);
  });
});

describe("send recipients", () => {
  it("accepts another address and returns it checksummed", () => {
    expect(checkRecipient(OTHER.toLowerCase(), SENDER, CHAIN)).toEqual({ ok: true, address: OTHER });
  });

  it("refuses empty, malformed, zero and own addresses", () => {
    expect(checkRecipient("", SENDER, CHAIN).ok).toBe(false);
    expect(checkRecipient("0x123", SENDER, CHAIN).ok).toBe(false);
    expect(checkRecipient("0x0000000000000000000000000000000000000000", SENDER, CHAIN).ok).toBe(false);
    expect(checkRecipient(SENDER.toLowerCase(), SENDER, CHAIN).ok).toBe(false);
  });

  it("refuses the USDC contract and every Contraflow contract", () => {
    const a = addressesForChain(CHAIN);
    for (const address of [a.usdc, a.registry, a.settler, a.nettingLedger]) {
      expect(checkRecipient(address, SENDER, CHAIN).ok).toBe(false);
    }
  });
});

describe("transfer calldata and messages", () => {
  it("encodes ERC-20 transfer(to, amount)", () => {
    const data = encodeTransfer(OTHER, 1_500_000n);
    const decoded = decodeFunctionData({ abi: parseAbi(["function transfer(address to, uint256 value) returns (bool)"]), data });
    expect(decoded.functionName).toBe("transfer");
    expect(decoded.args).toEqual([OTHER, 1_500_000n]);
  });

  it("explains known failures plainly", () => {
    expect(transferFailureMessage(new Error("User rejected the request."))).toMatch(/Cancelled/);
    expect(transferFailureMessage("execution reverted: Blocked address")).toMatch(/can't be sent to that address/);
    expect(transferFailureMessage(new Error("boom"))).toMatch(/didn't go through/);
  });
});

describe("pending send record", () => {
  function memory() {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    };
  }

  it("round-trips per owner and clears", () => {
    const storage = memory();
    savePendingSend(storage, { version: 1, owner: SENDER, chainId: CHAIN, to: OTHER, amount: "1500000", createdAt: 1 });
    expect(readPendingSend(storage, SENDER)?.amount).toBe("1500000");
    expect(readPendingSend(storage, OTHER)).toBeNull();
    clearPendingSend(storage, SENDER);
    expect(readPendingSend(storage, SENDER)).toBeNull();
  });

  it("ignores a corrupt record", () => {
    const storage = memory();
    storage.setItem(`contraflow:pending-send:${SENDER.toLowerCase()}`, "{not json");
    expect(readPendingSend(storage, SENDER)).toBeNull();
  });
});
