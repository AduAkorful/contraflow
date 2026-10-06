"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getAddress, type Address, type Hex } from "viem";
import {
  getEmbeddedConnectedWallet,
  useCreateWallet,
  useLogin,
  useWallets,
  type ConnectedWallet,
  type LinkedAccountWithMetadata,
  type User,
} from "@privy-io/react-auth";
import { useSetActiveWallet } from "@privy-io/wagmi";
import { ARC_TESTNET_CHAIN_ID } from "../../src/contracts/addresses";
import { requestNonce, signIn, whoAmI } from "../../src/app/app/siwe/actions";
import { buildSiweMessage } from "../../src/siwe/message";
import { connectedButUnsignedHint, signingInLabel } from "../../src/session/signInCopy";
import { loginCreatesEmbeddedWallet, pickSigningWallet } from "../../src/session/signingWallet";
import { useSession } from "../session/SessionProvider";
import {
  SignInApiProvider,
  type SignInApi,
  type SignInIdentity,
  type SignInPhase,
} from "./signInContext";

export type { SignInApi, SignInIdentity, SignInPhase } from "./signInContext";
export { useSignIn, useWalletReady } from "./signInContext";

function loginAccountAddress(account: LinkedAccountWithMetadata | null | undefined): string | null {
  if (!account || !("address" in account)) return null;
  const address = (account as { address?: unknown }).address;
  return typeof address === "string" ? address : null;
}

function emailOf(user: User | null | undefined): string | null {
  return user?.email?.address ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForEmbedded(read: () => ConnectedWallet[]): Promise<ConnectedWallet | null> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const found = getEmbeddedConnectedWallet(read());
    if (found) return found;
    await sleep(150);
  }
  return getEmbeddedConnectedWallet(read());
}

/// The one client wrapper around `useSignIn` that every surface uses. Privy `useLogin` callbacks
/// must be registered once, or each mounted Sign in button would complete SIWE in parallel.
export function SignInProvider({
  children,
  autoStartLogin = false,
}: {
  children: React.ReactNode;
  autoStartLogin?: boolean;
}) {
  const router = useRouter();
  const { setAddress: setSessionAddress } = useSession();
  const { wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const { setActiveWallet } = useSetActiveWallet();

  const walletsRef = useRef(wallets);
  walletsRef.current = wallets;
  const createWalletRef = useRef(createWallet);
  createWalletRef.current = createWallet;
  const setActiveWalletRef = useRef(setActiveWallet);
  setActiveWalletRef.current = setActiveWallet;
  const pendingRef = useRef(false);
  const completingRef = useRef(false);
  const startedAuto = useRef(false);

  const [phase, setPhase] = useState<SignInPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [identity, setIdentity] = useState<SignInIdentity | null>(null);
  const [sessionAddress, setLocalSession] = useState<string | null>(null);

  useEffect(() => {
    void whoAmI().then((r) => {
      if (r.address) {
        setLocalSession(r.address);
        setPhase("signed-in");
      }
    });
  }, []);

  const complete = useCallback(
    async (params: { user: User; loginMethod: string | null; loginAccount: LinkedAccountWithMetadata | null }) => {
      if (completingRef.current) return;
      completingRef.current = true;
      setError(null);
      setPhase("signing");
      try {
        let current = walletsRef.current;
        if (loginCreatesEmbeddedWallet(params.loginMethod) && !getEmbeddedConnectedWallet(current)) {
          try {
            await createWalletRef.current();
          } catch {
            // createOnLogin may already have created it; wait for it below.
          }
          const created = await waitForEmbedded(() => walletsRef.current);
          if (created) current = walletsRef.current;
        }

        let pick = pickSigningWallet({
          loginMethod: params.loginMethod,
          wallets: current.map((w) => ({ address: w.address, walletClientType: w.walletClientType })),
          loginAccountAddress: loginAccountAddress(params.loginAccount),
        });
        if (!pick.ok && pick.missingEmbedded) {
          try {
            await createWalletRef.current();
          } catch (err) {
            setError(err instanceof Error ? err.message : pick.error);
            setPhase("error");
            return;
          }
          const created = await waitForEmbedded(() => walletsRef.current);
          if (!created) {
            setError(pick.error);
            setPhase("error");
            return;
          }
          current = walletsRef.current;
          pick = pickSigningWallet({
            loginMethod: params.loginMethod,
            wallets: current.map((w) => ({ address: w.address, walletClientType: w.walletClientType })),
            loginAccountAddress: loginAccountAddress(params.loginAccount),
          });
        }
        if (!pick.ok) {
          setError(pick.error);
          setPhase("error");
          return;
        }

        const target =
          current.find(
            (w) =>
              w.address.toLowerCase() === pick.address.toLowerCase() && w.walletClientType === pick.walletClientType,
          ) ?? current.find((w) => w.address.toLowerCase() === pick.address.toLowerCase());
        if (!target) {
          setError("Couldn't attach the account wallet. Try signing in again.");
          setPhase("error");
          return;
        }

        await setActiveWalletRef.current(target);
        setIdentity({ address: getAddress(target.address), email: emailOf(params.user), kind: pick.kind });

        const checksummed = getAddress(target.address) as Address;
        const existing = await whoAmI();
        if (existing.address && existing.address.toLowerCase() === checksummed.toLowerCase()) {
          setLocalSession(existing.address);
          setSessionAddress(existing.address);
          setIdentity({ address: existing.address, email: emailOf(params.user), kind: pick.kind });
          setPhase("signed-in");
          router.refresh();
          return;
        }

        const { nonce, domain, uri } = await requestNonce();
        const now = new Date();
        const message = buildSiweMessage({
          domain,
          address: checksummed,
          statement: "Sign in to Contraflow.",
          uri,
          chainId: ARC_TESTNET_CHAIN_ID,
          nonce,
          issuedAt: now.toISOString(),
          expirationTime: new Date(now.getTime() + 5 * 60_000).toISOString(),
        });
        const signature = (await target.sign(message)) as Hex;
        const result = await signIn(message, signature);
        if (!result.ok) {
          setError(result.error);
          setPhase("error");
          return;
        }
        setLocalSession(result.address);
        setSessionAddress(result.address);
        setIdentity({ address: result.address, email: emailOf(params.user), kind: pick.kind });
        setPhase("signed-in");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to sign in.");
        setPhase("error");
      } finally {
        completingRef.current = false;
        pendingRef.current = false;
      }
    },
    [router, setSessionAddress],
  );

  const completeRef = useRef(complete);
  completeRef.current = complete;

  const { login } = useLogin({
    onComplete: (params) => {
      if (!pendingRef.current) return;
      void completeRef.current({
        user: params.user,
        loginMethod: params.loginMethod,
        loginAccount: params.loginAccount,
      });
    },
    onError: () => {
      pendingRef.current = false;
      setPhase("idle");
    },
  });

  const start = useCallback(() => {
    setError(null);
    pendingRef.current = true;
    setPhase("connecting");
    login();
  }, [login]);

  useEffect(() => {
    if (!autoStartLogin || startedAuto.current || phase !== "idle") return;
    startedAuto.current = true;
    start();
  }, [autoStartLogin, phase, start]);

  const value: SignInApi = {
    phase,
    error,
    identity,
    sessionAddress,
    hint:
      phase === "idle" || phase === "error" || phase === "connecting"
        ? null
        : identity
          ? connectedButUnsignedHint(identity.kind, identity.email)
          : null,
    signingLabel: signingInLabel(identity?.kind ?? "unknown"),
    start,
  };

  return (
    <SignInApiProvider value={value} walletReady>
      {children}
    </SignInApiProvider>
  );
}
