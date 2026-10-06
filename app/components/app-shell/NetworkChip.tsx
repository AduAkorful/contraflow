"use client";

import dynamic from "next/dynamic";
import { ARC_TESTNET_CHAIN_ID } from "../../src/contracts/addresses";
import { chainById } from "../../src/chain/client";
import { useWalletReady } from "../wallet/signInContext";

const LiveNetworkChip = dynamic(() => import("./LiveNetworkChip").then((m) => m.LiveNetworkChip), { ssr: false });

/// The network every signature in the app targets, visible before anything is signed. If the
/// connected wallet is on another network the chip says so; the app asks to switch before signing.
export function NetworkChip() {
  const ready = useWalletReady();
  if (ready) return <LiveNetworkChip />;

  const name = chainById(ARC_TESTNET_CHAIN_ID).name;
  return (
    <span
      className="inline-flex h-7 items-center gap-2 rounded-md border border-border-subtle bg-surface-2 px-2.5 text-xs font-medium text-muted"
      title={`Signatures and transactions go to ${name}`}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-success" />
      {name}
    </span>
  );
}
