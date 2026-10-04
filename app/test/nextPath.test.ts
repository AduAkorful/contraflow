import { describe, expect, it } from "vitest";
import { safeNextPath, signInHref } from "../src/session/nextPath";

describe("safeNextPath", () => {
  it.each(["/app/attest", "/app/obligations/new", "/app/o/AbCdEf123_-", "/app/attest/abc?x=1"])("accepts %s", (p) => {
    expect(safeNextPath(p)).toBe(p);
  });
  it.each([
    "/app",
    "/",
    "https://evil.example",
    "//evil.example",
    "/app//evil.example",
    "/app/\\evil",
    "/app/x://y",
    "/apple",
    "app/attest",
    "/app/a\nb",
    "/app/" + "a".repeat(700),
    "",
    undefined,
    null,
  ])("rejects %j", (p) => {
    expect(safeNextPath(p as string)).toBeNull();
  });
  it("rejects repeated query params (arrays)", () => {
    expect(safeNextPath(["/app/attest", "/app/balance"])).toBeNull();
  });
});

describe("signInHref", () => {
  it("encodes the page to return to", () => {
    expect(signInHref("/app/attest")).toBe("/app?next=%2Fapp%2Fattest");
  });
  it("falls back to the plain sign-in page for anything unsafe", () => {
    expect(signInHref("https://evil.example")).toBe("/app");
  });
});
