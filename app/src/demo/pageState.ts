/// Pure demo-page transitions. Kept out of the client page so settle-failure and idle-preview
/// behaviour can be unit-tested without rendering.

import { formatUsdc } from "../format/money";
import { deriveDemoParties } from "../fixtures/demoIdentities";
import { demoEdgeAmountUsdc } from "../fixtures/demoCycle";

export type DemoPhase = "idle" | "running" | "readyToSettle" | "settling" | "settleFailed" | "done";

export type DemoEdgeStatus = "preview" | "signing" | "registered" | "settling" | "settled";

export interface DemoEdgeView {
  fromLabel: string;
  toLabel: string;
  status: DemoEdgeStatus;
  amountUsdc?: string;
  explorerUrl?: string;
}

export type DemoCenterView =
  | { kind: "idle" }
  | { kind: "finding" }
  | { kind: "proposal"; wNetUsdc: string }
  | { kind: "settling" }
  | { kind: "failed" }
  | { kind: "settled"; grossCancelledUsdc: string };

export function demoIdleEdges(runSalt: string, partyCount: number): DemoEdgeView[] {
  const parties = deriveDemoParties(runSalt, partyCount);
  return parties.map((party, i) => ({
    fromLabel: party.label,
    toLabel: parties[(i + 1) % partyCount]!.label,
    status: "preview" as const,
    amountUsdc: String(demoEdgeAmountUsdc(i, runSalt)),
  }));
}

export function demoMinAmountUsdc(partyCount: number, runSalt: string): string {
  let min = BigInt(demoEdgeAmountUsdc(0, runSalt));
  for (let i = 1; i < partyCount; i++) {
    const amount = BigInt(demoEdgeAmountUsdc(i, runSalt));
    if (amount < min) min = amount;
  }
  return min.toString();
}

export function demoLeadSentence(partyCount: number, runSalt: string): string {
  const amounts = Array.from({ length: partyCount }, (_, i) => formatUsdc(String(demoEdgeAmountUsdc(i, runSalt))));
  const wNet = formatUsdc(demoMinAmountUsdc(partyCount, runSalt));
  const list =
    amounts.length === 1 ? amounts[0]!
    : `${amounts.slice(0, -1).join(", ")} and ${amounts[amounts.length - 1]!}`;
  const companies = partyCount === 1 ? "1 company" : `${partyCount} companies`;
  return `${companies} owe each other ${list}. Watch one transaction net ${wNet} of it.`;
}

export function demoEdgeAmountLabel(status: DemoEdgeStatus, amountUsdc?: string): string {
  if (status === "preview" || status === "registered") {
    return amountUsdc ? formatUsdc(amountUsdc) : "—";
  }
  if (status === "signing") return "signing...";
  if (status === "settling") return "settling...";
  if (status === "settled") return "settled";
  return "—";
}

export function demoNetToSettleLabel(wNetUsdc: string): string {
  return formatUsdc(wNetUsdc);
}

export function afterSettleFailure<E extends { status: string }>(edges: readonly E[]): {
  edges: Array<Omit<E, "status"> & { status: "registered" }>;
  center: { kind: "failed" };
  phase: "settleFailed";
  settleDisabled: true;
} {
  return {
    edges: edges.map((edge) => ({ ...edge, status: "registered" as const })),
    center: { kind: "failed" },
    phase: "settleFailed",
    settleDisabled: true,
  };
}
