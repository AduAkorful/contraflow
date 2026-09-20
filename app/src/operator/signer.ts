/// One abstraction for "the operator," whether backed by a raw private key or a Circle
/// Developer-Controlled Wallet — the thing actually missing from the "swappable signer" claim
/// made about this codebase before this step existed. `register.ts`/`settle.ts` dispatch on
/// `kind` internally so callers never choose between parallel raw-key/DCW functions again.
/// See `plans/11-orchestration.md`.

import type { WalletClient } from "viem";

export interface RawKeySigner {
  kind: "raw-key";
  walletClient: WalletClient;
}

export interface DcwSigner {
  kind: "dcw";
  apiKey: string;
  entitySecret: string;
  walletId: string;
  feeLevel?: "LOW" | "MEDIUM" | "HIGH";
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export type OperatorSigner = RawKeySigner | DcwSigner;
