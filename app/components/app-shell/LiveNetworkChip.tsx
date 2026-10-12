"use client";

import { useEffect, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { APP_CHAIN_ID } from "../../src/contracts/addresses";
import { chainById } from "../../src/chain/client";

/// Loaded only after the wallet tree is up, so signed-out chrome does not pull wagmi.
export function LiveNetworkChip() {
  const { chainId, isConnected, connector } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const name = chainById(APP_CHAIN_ID).name;
  const [actual, setActual] = useState<number | null>(null);
  const [switching, setSwitching] = useState(false);
  const [failed, setFailed] = useState(false);

  // The hook's chain can lag the wallet's (after an in-app switch, or a wallet that changed
  // network on its own), so the wallet itself is asked before the chip claims it is elsewhere.
  useEffect(() => {
    let live = true;
    setActual(null);
    if (!isConnected || !connector?.getChainId) return;
    void connector
      .getChainId()
      .then((id) => live && setActual(Number(id)))
      .catch(() => live && setActual(null));
    return () => {
      live = false;
    };
  }, [isConnected, connector, chainId]);

  const reported = actual ?? chainId;
  const elsewhere = isConnected && reported !== undefined && reported !== APP_CHAIN_ID;

  async function handleSwitch() {
    setFailed(false);
    setSwitching(true);
    try {
      await switchChainAsync({ chainId: APP_CHAIN_ID });
      setActual(APP_CHAIN_ID);
    } catch {
      setFailed(true);
    } finally {
      setSwitching(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="inline-flex h-7 items-center gap-2 rounded-md border border-border-subtle bg-surface-2 px-2.5 text-xs font-medium text-muted"
        title={elsewhere ? `Your wallet is on another network. Switch to ${name} before you sign.` : `Signatures and transactions go to ${name}`}
      >
        <span aria-hidden className={`size-1.5 rounded-full ${elsewhere ? "bg-muted" : "bg-success"}`} />
        {name}
        {elsewhere && <span className="hidden text-faint sm:inline">· wallet on another network</span>}
      </span>
      {elsewhere && (
        <button
          type="button"
          onClick={handleSwitch}
          disabled={switching}
          className="text-xs text-gold hover:underline disabled:text-faint disabled:no-underline"
        >
          {switching ? "Switching…" : `Switch to ${name}`}
        </button>
      )}
      {failed && (
        <span role="status" className="text-xs text-danger">
          Couldn&apos;t switch. Do it in your wallet.
        </span>
      )}
    </span>
  );
}
