"use client";

import { createContext, useContext, type ReactNode } from "react";
import { signingInLabel, type SignInKind } from "../../src/session/signInCopy";

export type SignInPhase = "idle" | "connecting" | "signing" | "signed-in" | "error";

export interface SignInIdentity {
  address: string;
  email: string | null;
  kind: SignInKind;
}

export interface SignInApi {
  phase: SignInPhase;
  error: string | null;
  identity: SignInIdentity | null;
  sessionAddress: string | null;
  hint: string | null;
  signingLabel: string;
  start: () => void;
}

const SignInContext = createContext<SignInApi | null>(null);
const WalletReadyContext = createContext(false);

export function idleSignInApi(start: () => void, phase: SignInPhase = "idle"): SignInApi {
  return {
    phase,
    error: null,
    identity: null,
    sessionAddress: null,
    hint: null,
    signingLabel: signingInLabel("unknown"),
    start,
  };
}

export function SignInApiProvider({
  value,
  walletReady,
  children,
}: {
  value: SignInApi;
  walletReady: boolean;
  children: ReactNode;
}) {
  return (
    <WalletReadyContext.Provider value={walletReady}>
      <SignInContext.Provider value={value}>{children}</SignInContext.Provider>
    </WalletReadyContext.Provider>
  );
}

export function useSignIn(): SignInApi {
  const ctx = useContext(SignInContext);
  if (!ctx) {
    throw new Error("useSignIn must be used within SignInProvider");
  }
  return ctx;
}

export function useWalletReady(): boolean {
  return useContext(WalletReadyContext);
}
