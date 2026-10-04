"use client";

import { useEffect, useState } from "react";
import { ARC_TESTNET_CHAIN_ID } from "../../src/contracts/addresses";
import { explorerAddressUrl } from "../../src/blockscout/explorer";
import { checksumAddress, formatAddress } from "../../src/format/address";

/// The one way to show an address: mono with contextual alternates off, 0x+4…4, the full address in
/// the title, a copy button and (where the chain has an explorer) a link to it.
export function Address({
  address,
  chainId = ARC_TESTNET_CHAIN_ID,
  link = true,
  copy = true,
  className,
}: {
  address: string;
  chainId?: number;
  link?: boolean;
  copy?: boolean;
  className?: string;
}) {
  const full = checksumAddress(address);
  const href = link ? explorerAddressUrl(chainId, full) : null;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
    } catch {
      // Clipboard can be unavailable (permissions, insecure context); the full address stays in the title.
    }
  }

  const text = formatAddress(full);
  return (
    <span className={["inline-flex items-center gap-1 align-baseline", className].filter(Boolean).join(" ")}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" title={full} className="font-mono hover:text-foreground hover:underline">
          {text}
        </a>
      ) : (
        <span title={full} className="font-mono">
          {text}
        </span>
      )}
      {copy && (
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? "Address copied" : `Copy address ${full}`}
          className="inline-flex size-5 items-center justify-center rounded text-faint hover:text-foreground"
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            {copied ? <path d="M3.5 8.5l3 3 6-7" /> : <><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" /><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" /></>}
          </svg>
        </button>
      )}
      <span role="status" className="sr-only">{copied ? "Copied" : ""}</span>
    </span>
  );
}
