import { describe, expect, it } from "vitest";
import { connectedButUnsignedHint, signingInLabel } from "../src/session/signInCopy";
import { isSignInPrimaryPage, pageNeedsWallet } from "../src/session/primarySignInPath";
import { sessionOwns } from "../src/session/owned";
import { safeNextPath } from "../src/session/nextPath";

describe("sign-in copy", () => {
  it("asks wallet users to check the prompt and email users to confirm", () => {
    expect(signingInLabel("external")).toBe("Check your wallet: a request is waiting. It may show a warning first.");
    expect(signingInLabel("embedded")).toBe("Confirming…");
    expect(signingInLabel("unknown")).toBe("Continue in the sign-in window…");
  });

  it("names the email on the connected-but-unsigned step", () => {
    expect(connectedButUnsignedHint("embedded", "you@email")).toContain("Welcome, you@email");
    expect(connectedButUnsignedHint("embedded", "you@email")).toContain("free, no transaction");
  });
});

describe("header Sign in visibility", () => {
  it("hides the header control where the body already has Sign in", () => {
    expect(isSignInPrimaryPage("/app")).toBe(true);
    expect(isSignInPrimaryPage("/app/attest")).toBe(true);
    expect(isSignInPrimaryPage("/app/c/token")).toBe(true);
    expect(isSignInPrimaryPage("/app/i/AbCdEf123_-xxxxxxxx")).toBe(true);
    expect(isSignInPrimaryPage("/app/history")).toBe(false);
    expect(isSignInPrimaryPage("/app/demo")).toBe(false);
  });

  it("does not load the wallet tree for read-only /app pages", () => {
    expect(pageNeedsWallet("/app")).toBe(false);
    expect(pageNeedsWallet("/app/history")).toBe(false);
    expect(pageNeedsWallet("/app/demo")).toBe(false);
    expect(pageNeedsWallet("/app/verify")).toBe(false);
    expect(pageNeedsWallet("/app/receipt/0xabc")).toBe(false);
    expect(pageNeedsWallet("/app/attest")).toBe(true);
    expect(pageNeedsWallet("/app/balance")).toBe(true);
    expect(pageNeedsWallet("/app/api-keys")).toBe(true);
    expect(isSignInPrimaryPage("/app/api-keys")).toBe(true);
    expect(pageNeedsWallet("/app/o/token")).toBe(true);
  });
});

describe("sessionOwns", () => {
  const A = "0x1111111111111111111111111111111111111111";
  const B = "0x2222222222222222222222222222222222222222";

  it("hides party A data once the session is party B", () => {
    expect(sessionOwns(B, A)).toBe(false);
    expect(sessionOwns(A, A)).toBe(true);
    expect(sessionOwns(null, A)).toBe(false);
    expect(sessionOwns(null, null)).toBe(true);
  });
});

describe("sign-in next path", () => {
  it("only follows a validated /app/... path", () => {
    expect(safeNextPath("/app/o/AbCdEf123_-")).toBe("/app/o/AbCdEf123_-");
    expect(safeNextPath("/app")).toBeNull();
    expect(safeNextPath("https://evil.example")).toBeNull();
  });
});
