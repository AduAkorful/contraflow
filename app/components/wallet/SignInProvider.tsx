"use client";

/// The one client wrapper around `useSignIn` that every surface uses. Privy `useLogin` callbacks
/// must be registered once, or each mounted Sign in button would complete SIWE in parallel.

export { SignInProvider, useSignIn, type SignInApi, type SignInIdentity, type SignInPhase } from "./useSignIn";
