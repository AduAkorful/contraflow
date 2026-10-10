/// Hands the "we sent you gas" message from the sign-in flow to whatever page is showing. Sign-in
/// can navigate between layouts, so the message waits in sessionStorage until a notice mounts.

const KEY = "contraflow:grant-notice";
const EVENT = "contraflow:grant-notice";

export function postGrantNotice(message: string): void {
  try {
    sessionStorage.setItem(KEY, message);
  } catch {
    // The event below still reaches a notice that is already mounted.
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: message }));
}

export function takeGrantNotice(): string | null {
  try {
    const message = sessionStorage.getItem(KEY);
    if (message) sessionStorage.removeItem(KEY);
    return message;
  } catch {
    return null;
  }
}

export function onGrantNotice(listener: (message: string) => void): () => void {
  const handler = (event: Event) => listener(String((event as CustomEvent).detail));
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
