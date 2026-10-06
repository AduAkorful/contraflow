"use client";

import dynamic from "next/dynamic";

const SettleLoopCard = dynamic(() => import("./SettleLoopCard").then((m) => m.SettleLoopCard), { ssr: false });

/// Keeps wagmi out of the signed-out `/app` page chunk. Overview is imported by that page even when
/// the session branch is not rendered.
export function ReadyToNet({ sessionAddress, embedded }: { sessionAddress: string; embedded?: boolean }) {
  return <SettleLoopCard sessionAddress={sessionAddress} embedded={embedded} />;
}
