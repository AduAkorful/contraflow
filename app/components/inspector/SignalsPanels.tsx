"use client";

/// Onchain signals for an address (`/app/history`) or for every party in a settled cycle
/// (`/app/receipt/[txHash]`). Deliberately neutral styling throughout: these are facts about
/// public addresses, and nothing here should read as an accusation against a real counterparty.

import type { ReactNode } from "react";
import type { AddressSignals, CycleSignals } from "../../src/inspector/signals";
import {
  describeAccountType,
  describeCycle,
  describeFirstFunder,
  describeFirstSeen,
  describeOutsideActivity,
  displayAddress,
  shortAddress,
} from "../../src/inspector/format";

const EXPLAINER =
  "Public onchain facts, read from the Arc explorer. They can help you judge whether parties are independent businesses. They can't prove an invoice is genuine or fake, and new or single-purpose addresses are normal for people new to Arc.";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 sm:flex-row sm:justify-between sm:gap-6">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm text-foreground/85 sm:text-right">{children}</dd>
    </div>
  );
}

function AddressRows({ signals }: { signals: AddressSignals }) {
  return (
    <dl className="divide-y divide-white/5">
      <Row label="First seen onchain">{describeFirstSeen(signals)}</Row>
      <Row label="Transactions outside Contraflow">{describeOutsideActivity(signals)}</Row>
      <Row label="First funded by">{describeFirstFunder(signals)}</Row>
      <Row label="Account type">{describeAccountType(signals)}</Row>
    </dl>
  );
}

function PanelShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="animate-card-entrance mt-8 rounded-card border border-white/10 bg-white/[0.02] p-5 sm:p-6">
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted">{EXPLAINER}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function SignalsLoading({ title }: { title: string }) {
  return (
    <section
      className="mt-8 rounded-card border border-white/10 bg-white/[0.02] p-5 sm:p-6"
      aria-busy="true"
      aria-label={`${title}, loading`}
    >
      <h2 className="text-sm font-medium">{title}</h2>
      <div className="mt-4 space-y-3" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex justify-between gap-6">
            <div className="animate-skeleton h-3 w-32 rounded" />
            <div className="animate-skeleton h-3 w-24 rounded" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function SignalsUnavailable({ title, message }: { title: string; message: string }) {
  return (
    <section className="mt-8 rounded-card border border-white/10 bg-white/[0.02] p-5 sm:p-6">
      <h2 className="text-sm font-medium">{title}</h2>
      <p className="mt-2 text-sm text-muted">{message}</p>
    </section>
  );
}

export function AddressSignalsPanel({ signals }: { signals: AddressSignals }) {
  return (
    <PanelShell title="Onchain signals">
      <AddressRows signals={signals} />
    </PanelShell>
  );
}

export function CycleSignalsPanel({ signals }: { signals: CycleSignals }) {
  const facts = describeCycle(signals);
  const partial = signals.parties.length < signals.cycleLength;

  return (
    <PanelShell title="About the parties in this cycle">
      {partial && (
        <p className="mb-3 text-xs text-muted">
          Covers {signals.parties.length} of the cycle&apos;s {signals.cycleLength} parties. The rest were registered too
          long ago for this view to look up.
        </p>
      )}
      <dl className="divide-y divide-white/5">
        {facts.map((fact) => (
          <Row key={fact.label} label={fact.label}>
            {fact.value}
            {fact.note && <span className="mt-0.5 block text-xs text-muted">{fact.note}</span>}
          </Row>
        ))}
      </dl>

      <div className="mt-6 space-y-3">
        {signals.parties.map((party) => (
          <details key={party.address} className="group rounded-lg border border-white/5 px-4 py-2">
            <summary className="cursor-pointer list-none py-1 text-sm">
              <span className="font-mono text-foreground/90" title={displayAddress(party.address)}>
                {shortAddress(party.address)}
              </span>
              <span className="ml-2 text-xs text-muted group-open:hidden">Show details</span>
            </summary>
            <AddressRows signals={party} />
          </details>
        ))}
      </div>
    </PanelShell>
  );
}
