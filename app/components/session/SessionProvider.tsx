"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { SESSION_CHANNEL, type SessionChannelMessage } from "../../src/session/channel";
import { sessionOwns } from "../../src/session/owned";

interface SessionContextValue {
  address: string | null;
  setAddress: (address: string | null) => void;
  /// True when this view's loaded data belongs to the current session (or there is no session).
  belongsToSession: (loadedFor: string | null | undefined) => boolean;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/// Server session fed into the client tree. Private client views render only while the data they
/// loaded is for this address, and other tabs hard-navigate away on sign-out.
export function SessionProvider({
  initialAddress,
  children,
}: {
  initialAddress: string | null;
  children: React.ReactNode;
}) {
  const [address, setAddress] = useState<string | null>(initialAddress);

  useEffect(() => {
    setAddress(initialAddress);
  }, [initialAddress]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(SESSION_CHANNEL);
    channel.onmessage = (event: MessageEvent<SessionChannelMessage>) => {
      if (event.data?.type === "signed-out") {
        window.location.assign("/app");
      }
    };
    return () => channel.close();
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      address,
      setAddress,
      belongsToSession: (loadedFor) => sessionOwns(address, loadedFor),
    }),
    [address],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    return {
      address: null,
      setAddress: () => undefined,
      belongsToSession: (loadedFor) => loadedFor == null,
    };
  }
  return ctx;
}

/// Renders children only while `loadedFor` is the current session. Used by private client views so
/// a leftover party-A payload can't sit on screen after the session becomes party B.
export function SessionBound({
  loadedFor,
  children,
}: {
  loadedFor: string | null | undefined;
  children: React.ReactNode;
}) {
  const { belongsToSession } = useSession();
  if (!belongsToSession(loadedFor)) return null;
  return <>{children}</>;
}
