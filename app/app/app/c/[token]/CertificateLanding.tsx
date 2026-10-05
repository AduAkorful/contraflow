"use client";

/// A party's page for one netting certificate. The link is only a handle: the certificate loads
/// after sign-in, for its parties only, and each party receives just its own two obligations in
/// full. This page checks what the server returned in the browser (the full verifier, plus the
/// ledger's current state) before offering to sign or apply, and stops on any failure.

import { useState } from "react";
import { useAccount, usePublicClient, useSignTypedData, useWriteContract, useSwitchChain } from "wagmi";
import { isAddressEqual, type Address, type Hex } from "viem";
import { ConnectButton } from "../../../../components/wallet/ConnectButton";
import { Address as AddressText } from "../../../../components/ui/Address";
import { displayDate, displayMinorAmount, shortAddr } from "../../../../components/netting/format";
import { groupChecks, statusMark, type CheckGroup } from "../../../../components/netting/checks";
import { checkAsParty } from "../../../../components/netting/partyChecks";
import { arcTestnet } from "../../../../src/chain/client";
import { contraflowNettingLedgerAbi } from "../../../../src/contracts/abi/index";
import { certificateTypedData } from "../../../../src/netting/certificate";
import { parseCertificateView } from "../../../../src/netting/serialize";
import type { ChainReader } from "../../../../src/netting/signature";
import type { CertificateView, EntryDocument } from "../../../../src/netting/types";
import type { PartyCertificate } from "../../../../src/obligations/certificates";
import { requestGrant } from "../../attest/actions";
import { prepareWalletContext } from "../../../../src/attest/walletContext";
import {
  declineCertificate,
  exportCertificate,
  getCertificate,
  recordCertificateApplied,
  signCertificate,
} from "../../obligations/actions";

type Phase = "signin" | "loading" | "not-found" | "invalid" | "loaded";

const INVALID = "This certificate failed a check in your browser. Don't sign or apply it.";
const EXPLORER = arcTestnet.blockExplorers?.default.url;

export function CertificateLanding({ token }: { token: string }) {
  const { address, isConnected, connector } = useAccount();
  const publicClient = usePublicClient();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const { switchChainAsync } = useSwitchChain();

  const [phase, setPhase] = useState<Phase>("signin");
  const [me, setMe] = useState<Address | null>(null);
  const [summary, setSummary] = useState<PartyCertificate | null>(null);
  const [view, setView] = useState<CertificateView | null>(null);
  const [groups, setGroups] = useState<CheckGroup[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load(session: Address) {
    setMe(session);
    setPhase("loading");
    setError(null);
    const result = await getCertificate(token);
    if (!result.ok) {
      setMessage(result.error);
      setPhase("not-found");
      return;
    }
    let parsed: CertificateView;
    try {
      parsed = parseCertificateView(result.certificate.view);
    } catch {
      setMessage(INVALID);
      setPhase("invalid");
      return;
    }
    const status = result.certificate.status;
    const stage = status === "applied" ? "applied" : status === "ready" ? "signed" : "proposed";
    const checked = await checkAsParty(parsed, session, publicClient as unknown as ChainReader | undefined, stage);
    setSummary(result.certificate);
    setView(parsed);
    setGroups(groupChecks(checked.checks));
    // An expired or abandoned certificate is shown as closed, not checked for action.
    if (!checked.ok && (status === "collecting" || status === "ready" || status === "applied")) {
      setMessage(INVALID);
      setPhase("invalid");
      return;
    }
    setPhase("loaded");
  }

  async function run(label: string, action: () => Promise<void>) {
    setError(null);
    setBusy(label);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message.split("\n")[0]! : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const handleSign = () =>
    run("Sign in your wallet...", async () => {
      if (!view || !me) return;
      const chainId = Number(view.domain.chainId);
      await prepareWalletContext(connector, me, chainId, switchChainAsync);
      const signature = await signTypedDataAsync(certificateTypedData(view.certificate, view.domain));
      await prepareWalletContext(connector, me, chainId, switchChainAsync);
      const result = await signCertificate(token, signature);
      if (!result.ok) throw new Error(result.error);
      await load(me);
    });

  const handleApply = () =>
    run("Preparing...", async () => {
      if (!view || !me || !publicClient) return;
      const chainId = Number(view.domain.chainId);
      await prepareWalletContext(connector, me, chainId, switchChainAsync);
      // One-time starter gas for a wallet that has none. Anything after that is the party's own.
      await requestGrant().catch(() => undefined);
      await prepareWalletContext(connector, me, chainId, switchChainAsync);
      setBusy("Confirm in your wallet...");
      const hash = await writeContractAsync({
        address: view.domain.verifyingContract,
        abi: contraflowNettingLedgerAbi,
        functionName: "applyCertificate",
        args: [view.certificate, view.signatures as Hex[]],
      });
      setBusy("Waiting for the ledger...");
      await publicClient.waitForTransactionReceipt({ hash });
      const recorded = await recordCertificateApplied(token, hash);
      if (!recorded.ok) console.error("recordCertificateApplied failed after a confirmed transaction:", recorded.error);
      await load(me);
    });

  const handleDecline = () =>
    run("Declining...", async () => {
      const result = await declineCertificate(token);
      if (!result.ok) throw new Error(result.error);
      if (me) await load(me);
    });

  const handleDownload = () =>
    run("Preparing download...", async () => {
      const result = await exportCertificate(token);
      if (!result.ok) throw new Error(result.error);
      const url = URL.createObjectURL(new Blob([result.json], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = result.fileName;
      link.click();
      URL.revokeObjectURL(url);
    });

  if (phase === "signin") {
    return (
      <div className="rounded-card border border-white/10 bg-white/[0.02] p-6 text-center sm:p-8">
        <h1 className="heading-1">A netting certificate</h1>
        <p className="mt-4 text-sm text-muted">
          Sign in with your wallet. A certificate is only shown to the parties in its loop.
        </p>
        <div className="mt-6">
          <ConnectButton onSignedIn={(a) => void load(a as Address)} onSignedOut={() => setPhase("signin")} />
        </div>
      </div>
    );
  }

  if (phase === "loading") return <p className="text-center text-sm text-muted">Checking the certificate...</p>;

  if (phase === "not-found" || phase === "invalid") {
    return (
      <div className="animate-error-shake rounded-card border border-red-500/30 bg-red-500/10 p-6 text-center">
        <p className="text-sm text-red-300">
          {phase === "not-found" && message === "Not found."
            ? "No certificate here for this wallet. Check you're signed in with an address in the loop."
            : message}
        </p>
        {phase === "invalid" && <CheckList groups={groups} />}
        {/* No onSignedIn here: it fires on mount for an existing session and would loop. */}
        <div className="mt-4">
          <ConnectButton onSignedOut={() => setPhase("signin")} />
        </div>
      </div>
    );
  }

  if (!summary || !view || !me) return null;

  const status = summary.status;
  const signer = view.certificate.entries[summary.yourIndex]?.debtor;
  const walletMatches = isConnected && address !== undefined && signer !== undefined && isAddressEqual(address as Address, signer);
  const own = view.entries.flatMap((e, i) => (e.kind === "full" ? [{ i, doc: e.document }] : []));
  const heading = {
    collecting: summary.youSigned ? "Waiting for the other parties" : "Review and sign",
    ready: "Signed by every party",
    applied: "Applied on the ledger",
    expired: "This certificate expired",
    abandoned: "This certificate was cancelled",
  }[status];

  return (
    <>
      <h1 className="heading-1">{heading}</h1>
      <p className="mt-4 text-sm text-muted">
        Nets <span className="text-foreground">{displayMinorAmount(summary.wNet, summary.currency)}</span> off every
        obligation in a loop of {summary.parties} parties. You see your own two obligations; the others are hidden from
        you, as yours are from them.
      </p>

      <div className="mt-8 rounded-card border border-white/10 bg-white/[0.02] p-6 sm:p-8">
        <p className="text-xs uppercase tracking-wide text-muted">The loop</p>
        <ol className="mt-3 flex flex-wrap items-center gap-2 font-mono text-sm">
          {view.certificate.entries.map((e, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className={isAddressEqual(e.debtor, me) ? "text-gold" : ""}>
                {isAddressEqual(e.debtor, me) ? "You" : shortAddr(e.debtor)}
              </span>
              <span className="text-xs text-muted">owes →</span>
            </li>
          ))}
          <li className={isAddressEqual(view.certificate.entries[0]!.debtor, me) ? "text-gold" : ""}>
            {isAddressEqual(view.certificate.entries[0]!.debtor, me) ? "You" : shortAddr(view.certificate.entries[0]!.debtor)}
          </li>
        </ol>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {own.map(({ i, doc }) => (
            <OwnObligation key={i} doc={doc} me={me} currency={summary.currency} />
          ))}
        </div>

        <p className="mt-6 text-xs uppercase tracking-wide text-muted">Checked in your browser</p>
        <CheckList groups={groups} />

        <div className="mt-6 flex flex-col items-center gap-3">
          {status === "collecting" && (
            <p className="text-xs text-muted">
              {summary.signedCount} of {summary.parties} signed · open until {displayDate(summary.deadline)}
            </p>
          )}
          {status === "collecting" &&
            !summary.youSigned &&
            (walletMatches ? (
              <ActionButton onClick={handleSign} busy={busy} label="Sign certificate" />
            ) : (
              <p className="text-center text-xs text-muted">Connect {signer ? shortAddr(signer) : "your wallet"} to sign.</p>
            ))}
          {status === "ready" &&
            (isConnected ? (
              <ActionButton onClick={handleApply} busy={busy} label="Apply on Arc" />
            ) : (
              <p className="text-center text-xs text-muted">Connect your wallet to apply it.</p>
            ))}
          {status === "applied" && summary.appliedTxHash && EXPLORER && (
            <a href={`${EXPLORER}/tx/${summary.appliedTxHash}`} target="_blank" rel="noreferrer" className="text-xs text-gold hover:underline">
              View the transaction →
            </a>
          )}
          {(status === "ready" || status === "applied") && (
            <button onClick={handleDownload} disabled={busy !== null} className="text-xs text-gold hover:underline disabled:state-disabled">
              Download certificate
            </button>
          )}
          {status === "collecting" && (
            <button onClick={handleDecline} disabled={busy !== null} className="text-xs text-muted hover:underline disabled:state-disabled">
              Decline
            </button>
          )}
          {error && <p className="text-center text-xs text-red-300">{error}</p>}
        </div>
      </div>

      <a href="/app/obligations" className="mt-6 inline-block text-xs text-gold hover:underline">
        ← Your obligations
      </a>
    </>
  );
}

function OwnObligation({ doc, me, currency }: { doc: EntryDocument; me: Address; currency: string }) {
  const youOwe = isAddressEqual(doc.obligation.debtor, me);
  const counterparty = youOwe ? doc.obligation.creditor : doc.obligation.debtor;
  return (
    <div className="rounded-lg border border-white/10 p-4 text-sm">
      <p>
        {youOwe ? "You owe" : "Owed to you by"} <AddressText address={counterparty} />
      </p>
      <p className="mt-2">
        <span className="text-muted">{displayMinorAmount(doc.remainingBefore.toString(), currency)}</span>
        {" → "}
        <span className="text-gold">{displayMinorAmount(doc.remainingAfter.toString(), currency)}</span>
      </p>
      <p className="mt-1 text-xs text-muted">Due {displayDate(doc.obligation.maturity.toString())}</p>
    </div>
  );
}

function CheckList({ groups }: { groups: CheckGroup[] }) {
  return (
    <ul className="mt-3 flex flex-col gap-1 text-left text-sm">
      {groups.map((g) => (
        <li key={g.label} className="flex items-center gap-2">
          <span aria-hidden className={g.status === "pass" ? "text-gold" : g.status === "fail" ? "text-red-300" : "text-muted"}>
            {statusMark(g.status)}
          </span>
          <span>{g.label}</span>
          {g.status !== "pass" && <span className="text-xs text-muted">({g.status === "fail" ? "failed" : "couldn't check"})</span>}
        </li>
      ))}
    </ul>
  );
}

function ActionButton({ onClick, busy, label }: { onClick: () => void; busy: string | null; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={busy !== null}
      className="rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black hover:scale-[1.02] disabled:state-disabled disabled:scale-100"
    >
      {busy ?? label}
    </button>
  );
}
