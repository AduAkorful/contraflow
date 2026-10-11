/// Other tabs listen for a sign-out so they don't keep showing the previous party's private data.

export const SESSION_CHANNEL = "contraflow-session";

/// One id per tab (per page load). A BroadcastChannel message reaches every other channel object
/// with the same name, including listeners in the tab that posted it. Without the id, the
/// signing-out tab's own SessionProvider would hear the message and send it to `/app`, overriding
/// the `/app?switch=1` that "Switch account" navigates to.
export const TAB_ID: string =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export type SessionChannelMessage = { type: "signed-out"; from?: string };

export function postSessionSignedOut(): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(SESSION_CHANNEL);
  const message: SessionChannelMessage = { type: "signed-out", from: TAB_ID };
  channel.postMessage(message);
  channel.close();
}

/// True when another tab signed out, so this one should leave the previous party's pages.
/// A tab's own sign-out navigates by itself and is ignored here.
export function isSignOutFromAnotherTab(data: unknown, tabId: string = TAB_ID): boolean {
  const message = data as Partial<SessionChannelMessage> | null | undefined;
  return message?.type === "signed-out" && message.from !== tabId;
}
