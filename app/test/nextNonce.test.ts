import { describe, expect, it, vi, beforeEach } from "vitest";

const fetchContractLogs = vi.fn();
vi.mock("../src/blockscout/client", async () => {
  const actual = await vi.importActual<typeof import("../src/blockscout/client")>("../src/blockscout/client");
  return { ...actual, fetchContractLogs };
});

const { resolveNextNonce } = await import("../src/attest/nextNonce");

const DEBTOR = "0xb1499Dd7F2b6161f3468bfe66c4d2A04aD04810C";
const CREDITOR = "0xD98CC80747e67B357EA914614C213209c877Be04";
const OTHER = "0x0000000000000000000000000000000000dEaD";

function registeredLog(debtor: string, creditor: string, nonce: string) {
  return {
    transactionHash: "0xtx",
    blockNumber: 1,
    methodCall: "InvoiceRegistered(bytes32 indexed id, address indexed debtor, address indexed creditor, uint256 amount, uint64 maturity, bool earlyNetConsent, uint256 nonce)",
    parameters: [
      { name: "id", type: "bytes32", value: "0xid" },
      { name: "debtor", type: "address", value: debtor },
      { name: "creditor", type: "address", value: creditor },
      { name: "amount", type: "uint256", value: "1000000" },
      { name: "maturity", type: "uint64", value: "1" },
      { name: "earlyNetConsent", type: "bool", value: "true" },
      { name: "nonce", type: "uint256", value: nonce },
    ],
  };
}

describe("resolveNextNonce", () => {
  beforeEach(() => fetchContractLogs.mockReset());

  it("returns 1 for a pair with no prior history", async () => {
    fetchContractLogs.mockResolvedValueOnce([]);
    expect(await resolveNextNonce(DEBTOR, CREDITOR)).toBe(1n);
  });

  it("returns max(nonce)+1 for a pair with prior registrations", async () => {
    fetchContractLogs.mockResolvedValueOnce([
      registeredLog(DEBTOR, CREDITOR, "1"),
      registeredLog(DEBTOR, CREDITOR, "2"),
      registeredLog(DEBTOR, CREDITOR, "3"),
    ]);
    expect(await resolveNextNonce(DEBTOR, CREDITOR)).toBe(4n);
  });

  it("ignores registrations for a different pair", async () => {
    fetchContractLogs.mockResolvedValueOnce([
      registeredLog(DEBTOR, CREDITOR, "1"),
      registeredLog(OTHER, CREDITOR, "5"),
      registeredLog(DEBTOR, OTHER, "9"),
    ]);
    expect(await resolveNextNonce(DEBTOR, CREDITOR)).toBe(2n);
  });

  it("matches addresses case-insensitively", async () => {
    fetchContractLogs.mockResolvedValueOnce([registeredLog(DEBTOR.toLowerCase(), CREDITOR.toLowerCase(), "1")]);
    expect(await resolveNextNonce(DEBTOR, CREDITOR)).toBe(2n);
  });
});
