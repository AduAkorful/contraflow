"use server";

/// Server Actions behind the wallet-connect sign-in flow — plans/20-session-wallet-connect.md.

import { cookies } from "next/headers";
import { issueNonce } from "../../../src/siwe/nonce";
import { verifySignIn } from "../../../src/siwe/verifySignIn";
import { createSessionToken } from "../../../src/session/cookie";
import { SESSION_COOKIE_NAME, getSession } from "../../../src/session/getSession";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name} — see app/.env.example`);
  return value;
}

export interface NonceResult {
  nonce: string;
  domain: string;
  uri: string;
}

export async function requestNonce(): Promise<NonceResult> {
  const domain = requireEnv("NEXT_PUBLIC_APP_DOMAIN");
  return {
    nonce: await issueNonce(),
    domain,
    uri: `https://${domain}`,
  };
}

export type SignInResult = { ok: true; address: string } | { ok: false; error: string };

export async function signIn(message: string, signature: `0x${string}`): Promise<SignInResult> {
  const domain = requireEnv("NEXT_PUBLIC_APP_DOMAIN");
  const result = await verifySignIn({ message, signature, expectedDomain: domain });
  if (!result.ok) return { ok: false, error: result.reason };

  const token = createSessionToken(result.address);
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 24 * 60 * 60,
  });

  return { ok: true, address: result.address };
}

export async function signOut(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}

export interface WhoAmIResult {
  address: string | null;
}

export async function whoAmI(): Promise<WhoAmIResult> {
  const session = await getSession();
  return { address: session?.address ?? null };
}
