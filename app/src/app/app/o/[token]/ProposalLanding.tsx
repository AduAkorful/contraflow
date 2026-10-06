"use client";

/// The counterparty's side of a short proposal link. The link is only a handle: the terms load
/// after sign-in, and only for one of the two parties. This page then re-verifies what the
/// server returned itself (document hash first, then the proposer's signature) before showing
/// any of it as trustworthy. A mismatch is a full stop, not a warning.

import { useEffect, useState } from "react";
import { useAccount, usePublicClient, useSwitchChain } from "wagmi";
import { isAddressEqual, type Address } from "viem";
import { ConnectButton } from "@/components/wallet/ConnectButton";
import { useContraflowSignTypedData } from "@/components/wallet/useContraflowSignTypedData";
import { SessionBound, useSession } from "@/components/session/SessionProvider";
import { obligationSigningConfirmation } from "@/src/format/signing";
import { signingInLabel } from "@/src/session/signInCopy";
import { isEmbeddedWalletClient } from "@/src/session/signingWallet";
import { useWallets } from "@privy-io/react-auth";
import { ObligationTerms } from "@/components/netting/ObligationTerms";
import { shortAddr } from "@/components/netting/format";
import { appLedgerDomain } from "@/src/netting/domain";
import { hashObligationDocument, obligationMatchesDocument } from "@/src/netting/document";
import { obligationId, obligationTypedData } from "@/src/netting/obligation";
import { prepareWalletContext } from "@/src/attest/walletContext";
import { parseObligationJson } from "@/src/netting/serialize";
import { checkSignature, type ChainReader } from "@/src/netting/signature";
import type { NettingObligation } from "@/src/netting/types";
import type { ProposalView } from "@/src/obligations/service";
import { acceptProposal, getProposal, withdrawProposal } from "../../obligations/actions";

type Phase =
  | "signin"
  | "loading"
  | "not-found"
  | "invalid"
  | "closed"
  | "waiting"
  | "ready"
  | "signing"
  | "saving"
  | "done";

const INVALID = "This proposal is invalid or has been altered. Don't sign it.";

export function ProposalLanding({ token }: { token: string }) {
  const { address, isConnected, connector } = useAccount();
  const { signTypedData } = useContraflowSignTypedData();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient();
  const { address: sessionAddress } = useSession();
  const { wallets } = useWallets();
  const signingKind = isEmbeddedWalletClient(wallets.find((w) => w.address.toLowerCase() === address?.toLowerCase())?.walletClientType)
    ? "embedded"
    : "external";

  const [phase, setPhase] = useState<Phase>("signin");
  const [proposal, setProposal] = useState<ProposalView | null>(null);
  const [obligation, setObligation] = useState<NettingObligation | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  async function load(session: Address) {
    setPhase("loading");
    setError(null);
    const result = await getProposal(token);
    if (!result.ok) {
      setMessage(result.error);
      setPhase("not-found");
      return;
    }
    const view = result.proposal;

    let parsed: NettingObligation;
    try {
      parsed = parseObligationJson(view.obligation);
    } catch {
      return fail();
    }
    const domain = appLedgerDomain();
    const sameDomain =
      view.domain.chainId === domain.chainId.toString() && isAddressEqual(view.domain.verifyingContract, domain.verifyingContract);
    // The document hash first: the terms shown must be exactly the ones signed.
    if (!sameDomain || hashObligationDocument(view.document) !== parsed.documentHash.toLowerCase()) return fail();
    if (!obligationMatchesDocument(parsed, view.document)) return fail();

    const proposer = view.proposerRole === "debtor" ? parsed.debtor : parsed.creditor;
    const signature = await checkSignature(
      proposer,
      obligationId(parsed, domain),
      view.proposerSignature,
      publicClient as unknown as ChainReader | undefined,
    );
    if (signature.status !== "pass") return fail();

    setProposal(view);
    setObligation(parsed);
    if (view.state !== "open") {
      setMessage(
        view.state === "accepted"
          ? "This obligation has been signed by both parties."
          : view.state === "withdrawn"
            ? "This proposal was withdrawn."
            : "This proposal has expired. Ask your counterparty for a new one.",
      );
      setPhase("closed");
      return;
    }
    setPhase(view.viewerRole === "proposer" ? "waiting" : "ready");
    setLoadedFor(session);
  }

  function fail() {
    setMessage(INVALID);
    setPhase("invalid");
  }

  async function handleSign() {
    if (!proposal || !obligation) return;
    setError(null);
    setPhase("signing");
    try {
      const expectedSigner = proposal.proposerRole === "debtor" ? obligation.creditor : obligation.debtor;
      const chainId = Number(appLedgerDomain().chainId);
      await prepareWalletContext(connector, expectedSigner, chainId, switchChainAsync);
      const signature = await signTypedData(obligationTypedData(obligation, appLedgerDomain()), {
        title: "Confirm this obligation",
        description: obligationSigningConfirmation({
          youOwe: expectedSigner.toLowerCase() === obligation.debtor.toLowerCase(),
          amountMinor: obligation.amount.toString(),
          currency: proposal.document.currency,
          counterparty:
            expectedSigner.toLowerCase() === obligation.debtor.toLowerCase() ? obligation.creditor : obligation.debtor,
          maturity: proposal.document.maturity,
          earlyNetConsent: proposal.document.earlyNetConsent,
        }),
      });
      await prepareWalletContext(connector, expectedSigner, chainId, switchChainAsync);
      setPhase("saving");
      const result = await acceptProposal(token, signature);
      if (!result.ok) {
        setError(result.error);
        setPhase("ready");
        return;
      }
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signing failed.");
      setPhase("ready");
    }
  }

  async function handleWithdraw() {
    setError(null);
    const result = await withdrawProposal(token);
    if (!result.ok) return setError(result.error);
    setMessage(proposal?.viewerRole === "proposer" ? "You withdrew this proposal." : "You declined this proposal.");
    setPhase("closed");
  }

  useEffect(() => {
    if (!sessionAddress) {
      setProposal(null);
      setObligation(null);
      setLoadedFor(null);
      setPhase("signin");
      return;
    }
    void load(sessionAddress as Address);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionAddress, token]);

  if (phase === "signin") {
    return (
      <div className="rounded-card border border-white/10 bg-white/[0.02] p-6 text-center sm:p-8">
        <h1 className="heading-1">Sign in</h1>
        <p className="mt-4 text-sm text-muted">This link is for a specific account.</p>
        <div className="mt-6">
          <ConnectButton />
        </div>
      </div>
    );
  }

  if (phase === "loading") return <p className="text-center text-sm text-muted">Checking the proposal...</p>;

  if (phase === "not-found" || phase === "invalid") {
    return (
      <div className="animate-error-shake rounded-card border border-red-500/30 bg-red-500/10 p-6 text-center">
        <p className="text-sm text-red-300">
          {phase === "not-found" && message === "Not found."
            ? "No proposal here for this wallet. Check you're signed in with the address it was sent to."
            : message}
        </p>
        <div className="mt-4">
          <ConnectButton />
        </div>
      </div>
    );
  }

  if (phase === "done" || phase === "closed") {
    return (
      <div className="animate-card-entrance rounded-card border border-gold/30 bg-gold/[0.06] p-6 text-center">
        <p className="text-sm">{phase === "done" ? "Signed by both parties and recorded." : message}</p>
        <a href="/app/obligations" className="mt-3 inline-block text-xs text-gold hover:underline">
          View your obligations →
        </a>
      </div>
    );
  }

  if (!proposal || !obligation) return null;

  const viewerRole =
    proposal.viewerRole === "proposer" ? proposal.proposerRole : proposal.proposerRole === "debtor" ? "creditor" : "debtor";
  const expectedSigner = viewerRole === "debtor" ? obligation.debtor : obligation.creditor;
  const walletMatches = isConnected && address !== undefined && isAddressEqual(address as Address, expectedSigner);

  return (
    <SessionBound loadedFor={loadedFor}>
    <>
      <h1 className="heading-1">
        {phase === "waiting" ? "Waiting for your counterparty" : "Review this obligation"}
      </h1>
      <p className="mt-4 text-sm text-muted">
        {phase === "waiting"
          ? "Send them this page's link. Once they sign, it's recorded for both of you."
          : "Signed by your counterparty and checked in your browser against their signature."}
      </p>
      <div className="mt-8">
        <ObligationTerms document={proposal.document} obligation={obligation} viewerRole={viewerRole}>
          <div className="flex flex-col items-center gap-3">
            {phase !== "waiting" &&
              (walletMatches ? (
                <>
                  <p className="max-w-sm text-center text-xs text-muted">
                    {obligationSigningConfirmation({
                      youOwe: viewerRole === "debtor",
                      amountMinor: obligation.amount.toString(),
                      currency: proposal.document.currency,
                      counterparty: viewerRole === "debtor" ? obligation.creditor : obligation.debtor,
                      maturity: proposal.document.maturity,
                      earlyNetConsent: proposal.document.earlyNetConsent,
                    })}
                  </p>
                <button
                  onClick={handleSign}
                  disabled={phase !== "ready"}
                  className="rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black hover:scale-[1.02] disabled:state-disabled disabled:scale-100"
                >
                  {phase === "signing" ? signingInLabel(signingKind) : phase === "saving" ? "Recording..." : "Sign obligation"}
                </button>
                </>
              ) : (
                <p className="text-center text-xs text-muted">
                  Connect {shortAddr(expectedSigner)} in your wallet to sign.
                </p>
              ))}
            <button onClick={handleWithdraw} className="text-xs text-muted hover:underline">
              {phase === "waiting" ? "Withdraw this proposal" : "Decline"}
            </button>
            {error && <p className="text-center text-xs text-red-300">{error}</p>}
          </div>
        </ObligationTerms>
      </div>
    </>
    </SessionBound>
  );
}
