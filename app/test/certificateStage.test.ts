import { describe, expect, it } from "vitest";
import { getAddress, type Address, type Hex } from "viem";
import { dbStatusToStage, resolveCertificateCheckStage } from "../src/netting/certificateStage";
import { fakeLedgerChain } from "./helpers/fakeLedgerChain";

const ledger = getAddress("0x00000000000000000000000000000000000c0ffe");
const id = ("0x" + "11".repeat(32)) as Hex;

describe("certificate check stage", () => {
  it("uses applied when the ledger has applied even if the database still says ready", async () => {
    const chain = fakeLedgerChain({ chainId: 5042002n, verifyingContract: ledger });
    chain.markApplied(id);
    const resolved = await resolveCertificateCheckStage({
      dbStatus: "ready",
      certificateId: id,
      client: chain.client,
      ledger: ledger as Address,
    });
    expect(resolved).toEqual({ stage: "applied", ledgerApplied: true, syncing: true });
  });

  it("stays at signed when the ledger has not applied a ready certificate", async () => {
    const chain = fakeLedgerChain({ chainId: 5042002n, verifyingContract: ledger });
    const resolved = await resolveCertificateCheckStage({
      dbStatus: "ready",
      certificateId: id,
      client: chain.client,
      ledger: ledger as Address,
    });
    expect(resolved).toEqual({ stage: "signed", ledgerApplied: false, syncing: false });
  });

  it("maps database status without a client", () => {
    expect(dbStatusToStage("collecting")).toBe("proposed");
    expect(dbStatusToStage("ready")).toBe("signed");
    expect(dbStatusToStage("applied")).toBe("applied");
  });
});
