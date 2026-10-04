"use client";

import { useAccount } from "wagmi";
import { ARC_TESTNET_CHAIN_ID } from "../../src/contracts/addresses";
import { chainById } from "../../src/chain/client";

/// The network every signature in the app targets, visible before anything is signed. If the
/// connected wallet is on another network the chip says so; the app asks to switch before signing.
export function NetworkChip() {
  const { chainId, isConnected } = useAccount();
  const name = chainById(ARC_TESTNET_CHAIN_ID).name;
  const elsewhere = isConnected && chainId !== undefined && chainId !== ARC_TESTNET_CHAIN_ID;

  return (
    <span
      className="inline-flex h-7 items-center gap-2 rounded-md border border-border-subtle bg-surface-2 px-2.5 text-xs font-medium text-muted"
      title={elsewhere ? `Your wallet is on another network. Contraflow will ask to switch to ${name} before you sign.` : `Signatures and transactions go to ${name}`}
    >
      <span aria-hidden className={`size-1.5 rounded-full ${elsewhere ? "bg-muted" : "bg-success"}`} />
      {name}
      {elsewhere && <span className="hidden text-faint sm:inline">· wallet on another network</span>}
    </span>
  );
}
