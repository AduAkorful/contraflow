/// Record action — plans/21-real-mode-attest-flow.md, plan 14's explicit "never trusts client-
/// supplied data for what to write" requirement. Takes only a tx hash, never the client's claimed
/// invoice struct: independently fetches the real receipt, confirms it's a genuine successful call
/// to the Registry contract, and decodes `InvoiceRegistered` itself. Without this, anyone could
/// report a fabricated tx hash/invoice pairing and write false rows into someone else's history.

import { decodeEventLog, type Address, type Hex } from "viem";
import { contraflowRegistryAbi } from "../contracts/abi/index";
import { addressesForChain, ARC_TESTNET_CHAIN_ID } from "../contracts/addresses";
import { arcPublicClient } from "../chain/operatorEnv";
import { upsertRegisteredInvoice } from "../db/invoices";

const USDC_DECIMALS = 1_000_000n;
function formatUsdc(baseUnits: bigint): string {
  return (Number(baseUnits) / Number(USDC_DECIMALS)).toFixed(2);
}

export type RecordResult = { ok: true; invoiceRef: Hex } | { ok: false; reason: string };

export async function recordRegistration(txHash: Hex): Promise<RecordResult> {
  const { registry } = addressesForChain(ARC_TESTNET_CHAIN_ID);
  const client = arcPublicClient();

  const receipt = await client.getTransactionReceipt({ hash: txHash }).catch(() => null);
  if (!receipt) return { ok: false, reason: "Transaction not found." };
  if (receipt.status !== "success") return { ok: false, reason: "Transaction did not succeed." };
  if (receipt.to?.toLowerCase() !== (registry as Address).toLowerCase()) {
    return { ok: false, reason: "Transaction was not a call to the Registry contract." };
  }

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== (registry as Address).toLowerCase()) continue;
    let decoded;
    try {
      decoded = decodeEventLog({ abi: contraflowRegistryAbi, data: log.data, topics: log.topics, eventName: "InvoiceRegistered" });
    } catch {
      continue;
    }
    const { id, debtor, creditor, amount, maturity, earlyNetConsent } = decoded.args as unknown as {
      id: Hex;
      debtor: Address;
      creditor: Address;
      amount: bigint;
      maturity: bigint;
      earlyNetConsent: boolean;
    };

    await upsertRegisteredInvoice({
      invoiceRef: id,
      debtor,
      creditor,
      amountUsdc: formatUsdc(amount),
      maturity: maturity.toString(),
      earlyNetConsent,
      registerTxHash: txHash,
    });

    return { ok: true, invoiceRef: id };
  }

  return { ok: false, reason: "Transaction did not emit InvoiceRegistered." };
}
