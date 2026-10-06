"use client";

/// The public certificate verifier. It parses an exported `contraflow-netting-certificate/1`
/// file and runs the standalone verifier against the ledger with this browser's own connection
/// to Arc. Nothing is sent to Contraflow's server.

import { useState } from "react";
import {
  describeCheck,
  groupChecks,
  statusMark,
  verificationPassedHeadline,
} from "@/components/netting/checks";
import { displayMinorAmount } from "@/components/netting/format";
import { parseCertificateView } from "@/src/netting/serialize";
import type { ChainReader } from "@/src/netting/signature";
import { verifyCertificateView, type VerificationResult } from "@/src/netting/verify";
import type { CertificateView } from "@/src/netting/types";
import { APP_CHAIN_ID } from "@/src/contracts/addresses";
import { createArcPublicClient } from "@/src/chain/client";
import sampleCertificate from "./sample-certificate.json";

const publicClient = createArcPublicClient(APP_CHAIN_ID);
const sampleJson = JSON.stringify(sampleCertificate, null, 2);

export function VerifyCertificate() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [view, setView] = useState<CertificateView | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [sample, setSample] = useState(false);

  async function verify(json: string) {
    setResult(null);
    setView(null);
    setSummary(null);
    setError(null);
    const isSample = json.trim() === sampleJson.trim();
    setSample(isSample);
    let parsed;
    try {
      parsed = parseCertificateView(json);
    } catch (err) {
      setError(`This isn't a readable certificate file: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    setChecking(true);
    try {
      const outcome = await verifyCertificateView(parsed, {
        now: BigInt(Math.floor(Date.now() / 1000)),
        stage: isSample ? "signed" : "applied",
        client: isSample ? undefined : (publicClient as unknown as ChainReader | undefined),
      });
      setView(parsed);
      setResult(outcome);
      setSummary(
        `${parsed.certificate.entries.length} obligations in ${parsed.currency}, each reduced by ${displayMinorAmount(
          parsed.wNet.toString(),
          parsed.currency,
        )}. Certificate ${parsed.certificate.certificateId.slice(0, 10)}…`,
      );
    } finally {
      setChecking(false);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    const content = await file.text();
    setText(content);
    await verify(content);
  }

  const failed = result ? result.checks.filter((c) => c.status !== "pass").length : 0;
  const fullCount = view ? view.entries.filter((e) => e.kind === "full").length : 0;
  const totalCount = view ? view.certificate.entries.length : 0;
  const groups = result ? groupChecks(result.checks) : [];

  return (
    <div className="mt-8 flex flex-col gap-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void onFile(e.dataTransfer.files[0]);
        }}
        className={`rounded-card border border-dashed p-6 text-center ${
          dragging ? "border-gold bg-gold/10" : "border-white/15 bg-white/[0.02]"
        }`}
      >
        <p className="text-sm">{checking ? "Checking..." : "Drop a certificate file here, or choose one"}</p>
        <input
          type="file"
          accept="application/json,.json"
          onChange={(e) => void onFile(e.target.files?.[0])}
          className="mt-3 text-sm text-muted file:mr-3 file:rounded-pill file:border file:border-white/15 file:bg-transparent file:px-4 file:py-1.5 file:text-sm file:text-foreground"
        />
      </div>
      <label className="text-xs uppercase tracking-wide text-muted" htmlFor="certificate-json">
        Or paste its contents
      </label>
      <textarea
        id="certificate-json"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text.trim()) void verify(text);
        }}
        placeholder="Paste a contraflow-netting-certificate/1 file"
        rows={6}
        className="w-full rounded-lg border border-white/10 bg-white/[0.02] p-3 font-mono text-xs"
      />
      <button
        type="button"
        onClick={() => {
          setText(sampleJson);
          void verify(sampleJson);
        }}
        className="self-start text-sm text-gold underline-offset-4 hover:underline"
      >
        Try a sample certificate
      </button>
      <p className="text-xs text-muted">A made-up certificate. It is not a settlement on Arc.</p>

      {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}

      {result && view && (
        <div className="rounded-card border border-white/10 bg-white/[0.02] p-6">
          {sample && (
            <p className="text-sm text-muted">This is a sample. It is not a settlement on Arc.</p>
          )}
          <p className={`text-sm${sample ? " mt-1" : ""}`}>
            {result.ok
              ? sample
                ? "The sample's signatures and hashes check out."
                : verificationPassedHeadline(fullCount, totalCount)
              : `${failed} of ${result.checks.length} checks did not pass.`}
          </p>
          {summary && <p className="mt-1 text-xs text-muted">{summary}</p>}
          <ul className="mt-4 flex flex-col gap-2 text-sm">
            {groups.map((g) => {
              const open = openGroup === g.label;
              return (
                <li key={g.label}>
                  <button
                    type="button"
                    onClick={() => setOpenGroup(open ? null : g.label)}
                    className="flex w-full items-center gap-2 text-left"
                  >
                    <span aria-hidden className={g.status === "pass" ? "text-gold" : g.status === "fail" ? "text-red-300" : "text-muted"}>
                      {statusMark(g.status)}
                    </span>
                    <span>{g.label}</span>
                    <span className="text-xs text-muted">{open ? "Hide" : "Show"}</span>
                  </button>
                  {open && (
                    <ul className="mt-2 ml-6 flex flex-col gap-1 text-xs text-muted">
                      {g.checks.map((c) => (
                        <li key={c.name}>
                          {statusMark(c.status)} {describeCheck(c.name)}
                          {c.detail ? ` · ${c.detail}` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
