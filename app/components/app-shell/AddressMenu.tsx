"use client";

import { useEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useDisconnect } from "wagmi";
import { queryClient } from "../../src/query/client";
import { signOut } from "../../src/app/app/siwe/actions";
import { ARC_TESTNET_CHAIN_ID } from "../../src/contracts/addresses";
import { explorerAddressUrl } from "../../src/blockscout/explorer";
import { checksumAddress, formatAddress } from "../../src/format/address";
import { signOutEverywhere } from "../session/signOutEverywhere";

/// The signed-in address with copy, explorer, switch account and sign-out. Closes on Escape and on any click outside.
export function AddressMenu({ address }: { address: string }) {
  const { user, logout } = usePrivy();
  const { disconnectAsync } = useDisconnect();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const full = checksumAddress(address);
  const explorer = explorerAddressUrl(ARC_TESTNET_CHAIN_ID, full);
  const email = user?.email?.address ?? null;

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointer(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be unavailable; the full address is still in the menu title.
    }
  }

  async function handleSignOut(then: "app" | "switch") {
    setSignOutError(null);
    const result = await signOutEverywhere({
      signOut,
      logout,
      disconnect: disconnectAsync,
      queryClient,
      then,
    });
    if (!result.ok) setSignOutError(result.error);
  }

  const item = "block w-full rounded-md px-3 py-2 text-left text-sm text-muted hover:bg-surface-2 hover:text-foreground";
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={full}
        className="inline-flex h-8 items-center gap-2 rounded-md border border-border-input bg-surface-1 px-3 font-mono text-xs text-foreground hover:bg-surface-2"
      >
        {formatAddress(full)}
        <svg aria-hidden viewBox="0 0 16 16" className="size-3 text-faint" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-10 z-40 w-72 rounded-lg border border-border-subtle bg-surface-1 p-1 shadow-xl">
          {email && (
            <p className="px-3 py-2 text-xs text-foreground">
              {email}
              <span className="mt-1 block text-faint">
                Account wallet {formatAddress(full)}{" "}
                <span className="cursor-help" title="Created for you when you signed in with email. It signs for this account.">
                  (what&apos;s this?)
                </span>
              </span>
            </p>
          )}
          <button role="menuitem" type="button" onClick={copy} className={item}>
            {copied ? "Copied" : "Copy address"}
          </button>
          {explorer && (
            <a role="menuitem" href={explorer} target="_blank" rel="noreferrer" className={item}>
              View on explorer
            </a>
          )}
          <button role="menuitem" type="button" onClick={() => void handleSignOut("switch")} className={item}>
            Switch account
          </button>
          <button role="menuitem" type="button" onClick={() => void handleSignOut("app")} className={item}>
            Sign out
          </button>
          {signOutError && (
            <p role="alert" className="px-3 py-2 text-xs text-danger">
              {signOutError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
