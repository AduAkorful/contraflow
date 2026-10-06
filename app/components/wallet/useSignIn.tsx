"use client";

/// Hook and types live in `signInContext` so chrome that only needs `start()` does not pull Privy.
export {
  useSignIn,
  useWalletReady,
  type SignInApi,
  type SignInIdentity,
  type SignInPhase,
} from "./signInContext";
