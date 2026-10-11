import { afterEach, describe, expect, it, vi } from "vitest";
import { isSignOutFromAnotherTab, postSessionSignedOut, TAB_ID } from "../src/session/channel";

describe("session sign-out channel", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("ignores this tab's own sign-out and reacts to another tab's", () => {
    expect(isSignOutFromAnotherTab({ type: "signed-out", from: TAB_ID })).toBe(false);
    expect(isSignOutFromAnotherTab({ type: "signed-out", from: "other-tab" })).toBe(true);
    // Older senders without an id still sign other tabs out.
    expect(isSignOutFromAnotherTab({ type: "signed-out" })).toBe(true);
    expect(isSignOutFromAnotherTab({ type: "something-else", from: "other-tab" })).toBe(false);
    expect(isSignOutFromAnotherTab(null)).toBe(false);
  });

  it("tags the posted message with this tab's id", () => {
    const posted: unknown[] = [];
    class FakeChannel {
      constructor(public name: string) {}
      postMessage(message: unknown) {
        posted.push(message);
      }
      close() {}
    }
    vi.stubGlobal("BroadcastChannel", FakeChannel);
    postSessionSignedOut();
    expect(posted).toEqual([{ type: "signed-out", from: TAB_ID }]);
    expect(isSignOutFromAnotherTab(posted[0])).toBe(false);
  });
});
