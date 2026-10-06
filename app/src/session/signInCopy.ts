/// Sign-in wording that doesn't assume a browser-extension wallet.

export type SignInKind = "embedded" | "external";

export function signingInLabel(kind: SignInKind | "unknown"): string {
  if (kind === "embedded") return "Confirming…";
  if (kind === "unknown") return "Continue in the sign-in window…";
  return "Check your wallet: a request is waiting. It may show a warning first.";
}

export function connectedButUnsignedHint(kind: SignInKind, email: string | null): string {
  if (kind === "embedded" && email) {
    return `Welcome, ${email}. Confirm once to finish signing in: free, no transaction.`;
  }
  return "Your wallet is connected. Signing in takes one free signature: no transaction, no gas.";
}

export function nextStepsYouSign(): string {
  return "One signature, free: no transaction and no gas.";
}
