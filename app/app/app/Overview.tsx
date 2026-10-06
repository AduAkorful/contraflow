import Link from "next/link";
import type { Address as Hex } from "viem";
import { Address } from "../../components/ui/Address";
import { Money } from "../../components/ui/Money";
import { displayMajorAmount, displayMinorAmount } from "../../components/netting/format";
import { getRecentInvoicesForAddress, type InvoiceRow } from "../../src/db/invoices";
import { certificateService } from "../../src/obligations/certificateDefaults";
import type { CertificateSummary } from "../../src/obligations/certificates";
import { listMine, type ProposalSummary } from "../../src/obligations/service";
import { SettleLoopCard } from "../../components/settle/SettleLoopCard";

const RECENT_INVOICES = 5;

type Loaded<T> = { ok: true; value: T } | { ok: false; error: string };

/// A failure is shown as a failure in that section, never as an empty list that reads as "nothing".
async function load<T>(label: string, run: () => Promise<T | { ok: false; error: string }>): Promise<Loaded<T>> {
  try {
    const value = await run();
    if (value && typeof value === "object" && "ok" in value && value.ok === false) return { ok: false, error: value.error };
    return { ok: true, value: value as T };
  } catch {
    return { ok: false, error: `Couldn't load ${label} right now.` };
  }
}

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-card border border-border-subtle bg-surface-1">
      <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-5 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Row({ href, cta, children }: { href: string; cta: string; children: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
      <div className="min-w-0 text-sm">{children}</div>
      <Link href={href} className="shrink-0 text-sm text-gold hover:underline">
        {cta} →
      </Link>
    </li>
  );
}

function ProposalLine({ p }: { p: ProposalSummary }) {
  return (
    <>
      <p>
        {p.youOwe ? "You owe" : "Owed to you by"} <Address address={p.counterparty} className="text-foreground/90" />
      </p>
      <p className="mt-0.5 truncate text-xs text-muted">
        {displayMajorAmount(p.amount, p.currency)} · {p.description}
      </p>
    </>
  );
}

function CertificateLine({ c }: { c: CertificateSummary }) {
  return (
    <>
      <p>Netting certificate, {c.parties} parties</p>
      <p className="mt-0.5 text-xs text-muted">
        Nets {displayMinorAmount(c.wNet, c.currency)} off each obligation · {c.signedCount} of {c.parties} signed
      </p>
    </>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="px-5 py-4 text-sm text-muted">{children}</p>;
const Failed = ({ error }: { error: string }) => (
  <p role="alert" className="px-5 py-4 text-sm text-danger">
    {error}
  </p>
);

export async function Overview({ address }: { address: string }) {
  const me = address as Hex;
  const [mine, certificates, invoices] = await Promise.all([
    load("your obligations", () => listMine(me)),
    // Listing certificates also brings any the ledger has applied up to date.
    load("your certificates", () => certificateService().listCertificates(me)),
    load<InvoiceRow[]>("your invoices", () => getRecentInvoicesForAddress(address, RECENT_INVOICES)),
  ]);

  const openCertificates = certificates.ok ? certificates.value.certificates.filter((c) => c.status === "collecting") : [];
  const proposals = mine.ok ? mine.value.proposals : [];
  const waitingOnYou = {
    proposals: proposals.filter((p) => p.waitingOn === "you"),
    certificates: openCertificates.filter((c) => !c.youSigned),
  };
  const waitingOnOthers = {
    proposals: proposals.filter((p) => p.waitingOn === "them"),
    certificates: openCertificates.filter((c) => c.youSigned),
  };
  const youCount = waitingOnYou.proposals.length + waitingOnYou.certificates.length;
  const othersCount = waitingOnOthers.proposals.length + waitingOnOthers.certificates.length;
  const loadError = [mine, certificates].find((r) => !r.ok);

  return (
    <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="heading-1">Overview</h1>
      <p className="mt-2 text-sm text-muted">
        Signed in as <Address address={address} className="text-foreground/90" />
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/app/attest" className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-black">
          Send an invoice (USDC)
        </Link>
        <Link href="/app/obligations/new" className="rounded-md border border-border-input px-4 py-2 text-sm text-foreground hover:bg-surface-2">
          Record a debt (any currency)
        </Link>
      </div>

      <div className="mt-8">
        <SettleLoopCard sessionAddress={address} />
      </div>

      <div className="mt-8 grid gap-6">
        <Card title="Waiting on you">
          {loadError && !loadError.ok && <Failed error={loadError.error} />}
          {youCount === 0 && !loadError && <Empty>Nothing is waiting on you.</Empty>}
          {youCount > 0 && (
            <ul className="divide-y divide-border-subtle">
              {waitingOnYou.proposals.map((p) => (
                <Row key={p.token} href={`/app/o/${p.token}`} cta="Review and sign">
                  <ProposalLine p={p} />
                </Row>
              ))}
              {waitingOnYou.certificates.map((c) => (
                <Row key={c.token} href={`/app/c/${c.token}`} cta="Review and sign">
                  <CertificateLine c={c} />
                </Row>
              ))}
            </ul>
          )}
        </Card>

        {othersCount > 0 && (
          <Card title="Waiting on others">
            <ul className="divide-y divide-border-subtle">
              {waitingOnOthers.proposals.map((p) => (
                <Row key={p.token} href={`/app/o/${p.token}`} cta="Open link">
                  <ProposalLine p={p} />
                </Row>
              ))}
              {waitingOnOthers.certificates.map((c) => (
                <Row key={c.token} href={`/app/c/${c.token}`} cta="View">
                  <CertificateLine c={c} />
                </Row>
              ))}
            </ul>
          </Card>
        )}

        <Card
          title="Recent invoices"
          action={
            <Link href="/app/history" className="text-sm text-muted hover:text-foreground hover:underline">
              All history →
            </Link>
          }
        >
          {!invoices.ok && <Failed error={invoices.error} />}
          {invoices.ok && invoices.value.length === 0 && (
            <Empty>No invoices recorded for this address yet. History checks the chain for anything newer.</Empty>
          )}
          {invoices.ok && invoices.value.length > 0 && (
            <ul className="divide-y divide-border-subtle">
              {invoices.value.map((inv) => {
                const owed = inv.creditor.toLowerCase() === address.toLowerCase();
                return (
                  <li key={inv.invoiceRef} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-sm">
                    <div className="min-w-0">
                      <p>
                        {owed ? "Owed by" : "Owed to"} <Address address={owed ? inv.debtor : inv.creditor} className="text-foreground/90" />
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        <Money value={inv.amountUsdc} />
                        {inv.status === "settled" && inv.remainingUsdc !== null && (
                          <>
                            {" "}
                            · now <Money value={inv.remainingUsdc} /> remaining
                          </>
                        )}
                      </p>
                    </div>
                    {inv.settleTxHash ? (
                      <Link href={`/app/receipt/${inv.settleTxHash}`} className="shrink-0 text-gold hover:underline">
                        Receipt →
                      </Link>
                    ) : (
                      <span className="shrink-0 text-xs text-muted">Registered</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </section>
  );
}
