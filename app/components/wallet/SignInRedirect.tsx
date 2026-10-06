"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ConnectButton } from "./ConnectButton";
import { useSignIn } from "./useSignIn";

/// Sign-in on `/app`. A new sign-in stays here (the server refresh then shows Overview) or follows
/// a validated `next`. `autoStart` reopens the modal after "Switch account".
export function SignInRedirect({ next, autoStart = false }: { next: string | null; autoStart?: boolean }) {
  const router = useRouter();
  const { start, phase, sessionAddress } = useSignIn();
  const started = useRef(false);

  useEffect(() => {
    if (!autoStart || started.current || phase !== "idle") return;
    started.current = true;
    start();
  }, [autoStart, phase, start]);

  useEffect(() => {
    if (sessionAddress && next) router.push(next);
  }, [sessionAddress, next, router]);

  return <ConnectButton />;
}
