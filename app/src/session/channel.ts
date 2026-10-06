/// Other tabs listen for a sign-out so they don't keep showing the previous party's private data.

export const SESSION_CHANNEL = "contraflow-session";

export type SessionChannelMessage = { type: "signed-out" };

export function postSessionSignedOut(): void {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(SESSION_CHANNEL);
  const message: SessionChannelMessage = { type: "signed-out" };
  channel.postMessage(message);
  channel.close();
}
