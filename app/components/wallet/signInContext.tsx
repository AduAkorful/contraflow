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
  /// Opens the header sign-in panel. Does not start a method.
  start: () => void;
  menuOpen: boolean;
  openMenu: () => void;
  closeMenu: () => void;
  /// Resolves to an error message, or null when the code was sent.
  sendEmailCode: (email: string) => Promise<string | null>;
  submitEmailCode: (code: string) => Promise<string | null>;
  startWallet: () => void;
}

const SignInContext = createContext<SignInApi | null>(null);
const WalletReadyContext = createContext(false);

export function idleSignInApi(openMenu: () => void, phase: SignInPhase = "idle"): SignInApi {
  return {
    phase,
    error: null,
    identity: null,
    sessionAddress: null,
    hint: null,
    signingLabel: signingInLabel("unknown"),
    start: openMenu,
    menuOpen: false,
    openMenu,
    closeMenu: () => undefined,
    sendEmailCode: async () => "Sign-in is still loading.",
    submitEmailCode: async () => "Sign-in is still loading.",
    startWallet: openMenu,
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
