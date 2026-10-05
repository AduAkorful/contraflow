"use client";

/// The public certificate verifier. It parses an exported `contraflow-netting-certificate/1`
/// file and runs the standalone verifier against the ledger with this browser's own connection
/// to Arc. Nothing is sent to Contraflow's server.

import { useState } from "react";
import { usePublicClient } from "wagmi";
import { describeCheck, statusMark } from "../../../components/netting/checks";
import { displayMinorAmount } from "../../../components/netting/format";
import { parseCertificateView } from "../../../src/netting/serialize";
import type { ChainReader } from "../../../src/netting/signature";
import { verifyCertificateView, type VerificationResult } from "../../../src/netting/verify";

export function VerifyCertificate() {
  const publicClient = usePublicClient();
  const [text, setText] = useState("");
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function verify(json: string) {
    setResult(null);
    setSummary(null);
    setError(null);
    let view;
    try {
      view = parseCertificateView(json);
    } catch (err) {
      setError(`This isn't a readable certificate file: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    setChecking(true);
    try {
      const outcome = await verifyCertificateView(view, {
        now: BigInt(Math.floor(Date.now() / 1000)),
        stage: "applied",
        client: publicClient as unknown as ChainReader | undefined,
      });
      setResult(outcome);
      setSummary(
        `${view.certificate.entries.length} obligations in ${view.currency}, each reduced by ${displayMinorAmount(
          view.wNet.toString(),
          view.currency,
        )}. Certificate ${view.certificate.certificateId.slice(0, 10)}…`,
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

  return (
    <div className="mt-8 flex flex-col gap-4">
      <label className="text-xs uppercase tracking-wide text-muted" htmlFor="certificate-json">
        Certificate file
      </label>
      <input
        type="file"
        accept="application/json,.json"
        onChange={(e) => void onFile(e.target.files?.[0])}
        className="text-sm text-muted file:mr-3 file:rounded-pill file:border file:border-white/15 file:bg-transparent file:px-4 file:py-1.5 file:text-sm file:text-foreground"
      />
      <textarea
        id="certificate-json"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="…or paste its contents here"
        rows={8}
        className="w-full rounded-lg border border-white/10 bg-white/[0.02] p-3 font-mono text-xs"
      />
      <button
        onClick={() => void verify(text)}
        disabled={checking || text.trim().length === 0}
        className="self-start rounded-pill bg-gold px-6 py-3 text-sm font-medium text-black hover:scale-[1.02] disabled:state-disabled disabled:scale-100"
      >
        {checking ? "Checking..." : "Verify"}
      </button>

      {error && <p className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</p>}

      {result && (
        <div className="rounded-card border border-white/10 bg-white/[0.02] p-6">
          <p className="text-sm">
            {result.ok ? "Every check passed." : `${failed} of ${result.checks.length} checks did not pass.`}
          </p>
          {summary && <p className="mt-1 text-xs text-muted">{summary}</p>}
          <ul className="mt-4 flex flex-col gap-2 text-sm">
            {result.checks.map((c) => (
              <li key={c.name} className="flex gap-2">
                <span aria-hidden className={c.status === "pass" ? "text-gold" : c.status === "fail" ? "text-red-300" : "text-muted"}>
                  {statusMark(c.status)}
                </span>
                <span>
                  {describeCheck(c.name)}
                  <span className="text-xs text-muted">
                    {" "}
                    · {c.status === "pass" ? "passed" : c.status === "fail" ? "failed" : "couldn't check"}
                    {c.detail ? ` · ${c.detail}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
