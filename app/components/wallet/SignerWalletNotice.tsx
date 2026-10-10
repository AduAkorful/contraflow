"use client";

import { formatAddress } from "../../src/format/address";
import type { useSignerWallet } from "./useSignerWallet";

/// Shown beside a Sign button when the signing wallet isn't the signed-in account yet. Nothing
/// when it is.
export function SignerWalletNotice({
  wallet,
  signerAddress,
}: {
  wallet: ReturnType<typeof useSignerWallet>;
  signerAddress: string;
}) {
  if (wallet.state === "ready") return null;
  if (wallet.state === "syncing") {
    return (
      <p role="status" className="text-center text-xs text-muted">
        Connecting your wallet…
      </p>
    );
  }
  return (
    <div role="alert" className="flex flex-col items-center gap-2 text-center">
      <p className="text-xs text-muted">
        {wallet.state === "mismatch"
          ? `Your connected wallet (${formatAddress(wallet.connectedAddress ?? "")}) isn't the account you signed in with (${formatAddress(signerAddress)}).`
          : `You're signed in as ${formatAddress(signerAddress)}, but your wallet isn't connected in this tab.`}
      </p>
      <button
        type="button"
        onClick={wallet.connect}
        className="rounded-pill border border-border-input px-4 py-2 text-sm hover:border-white/30"
      >
        Connect the signed-in account
      </button>
    </div>
  );
}
