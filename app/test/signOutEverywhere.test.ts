import { afterEach, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import { signOutEverywhere } from "../components/session/signOutEverywhere";
import { SESSION_CHANNEL } from "../src/session/channel";

function harness(signOutResult: { ok: true } | { ok: false; error: string } = { ok: true }) {
  const calls: string[] = [];
  const assign = vi.fn((url: string) => calls.push(`navigate:${url}`));
  vi.stubGlobal("window", { location: { assign } });
  const deps = {
    signOut: vi.fn(async () => {
      calls.push("signOut");
      return signOutResult;
    }),
    logout: vi.fn(async () => {
      calls.push("logout");
    }),
    disconnect: vi.fn(async () => {
      calls.push("disconnect");
    }),
    queryClient: { clear: vi.fn(() => calls.push("clear")) } as unknown as QueryClient,
  };
  return { calls, assign, deps };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("signOutEverywhere", () => {
  it("revokes, drops wallets, clears cached data, tells other tabs, then hard-navigates", async () => {
    const { calls, deps } = harness();
    const listener = new BroadcastChannel(SESSION_CHANNEL);
    const received = new Promise<unknown>((resolve) => {
      listener.onmessage = (event) => {
        calls.push("broadcast");
        resolve(event.data);
      };
    });

    await expect(signOutEverywhere(deps)).resolves.toEqual({ ok: true });
    await expect(received).resolves.toEqual({ type: "signed-out" });
    listener.close();

    expect(calls.slice(0, 4)).toEqual(["signOut", "logout", "disconnect", "clear"]);
    expect(calls).toContain("navigate:/app");
    expect(calls.indexOf("clear")).toBeLessThan(calls.indexOf("navigate:/app"));
  });

  it("goes to the account switcher when asked", async () => {
    const { assign, deps } = harness();
    await signOutEverywhere({ ...deps, then: "switch" });
    expect(assign).toHaveBeenCalledWith("/app?switch=1");
  });

  it("keeps everything when the server could not revoke the session", async () => {
    const { calls, assign, deps } = harness({ ok: false, error: "Couldn't sign out." });
    await expect(signOutEverywhere(deps)).resolves.toEqual({ ok: false, error: "Couldn't sign out." });
    expect(calls).toEqual(["signOut"]);
    expect(assign).not.toHaveBeenCalled();
  });

  it("still clears and navigates when the wallet libraries throw on the way out", async () => {
    const { calls, deps } = harness();
    deps.logout.mockRejectedValueOnce(new Error("already out"));
    deps.disconnect.mockRejectedValueOnce(new Error("no-op"));
    await signOutEverywhere(deps);
    expect(calls).toContain("clear");
    expect(calls).toContain("navigate:/app");
  });
});
