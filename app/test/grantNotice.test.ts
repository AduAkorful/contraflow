import { beforeEach, describe, expect, it, vi } from "vitest";
import { onGrantNotice, postGrantNotice, takeGrantNotice } from "../src/attest/grantNotice";

beforeEach(() => {
  const store = new Map<string, string>();
  const target = new EventTarget();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal("window", {
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  });
});

describe("grant notice hand-off", () => {
  it("keeps a posted message until it is taken, once", () => {
    postGrantNotice("We sent you 0.05 test USDC to cover network fees.");
    expect(takeGrantNotice()).toBe("We sent you 0.05 test USDC to cover network fees.");
    expect(takeGrantNotice()).toBeNull();
  });

  it("reaches a listener that is already mounted", () => {
    const listener = vi.fn();
    const off = onGrantNotice(listener);
    postGrantNotice("sent");
    expect(listener).toHaveBeenCalledWith("sent");
    off();
    postGrantNotice("again");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
