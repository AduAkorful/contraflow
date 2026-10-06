"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

const Live = dynamic(() => import("./MarketingSignInLive").then((m) => m.MarketingSignInLive), { ssr: false });

const buttonClass = "inline-flex h-8 items-center rounded-pill bg-gold px-3 text-sm font-medium text-black";

/// Marketing pages stay off the wallet tree until Sign in is clicked.
export function MarketingSignIn() {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={buttonClass}>
        Sign in
      </button>
    );
  }
  return <Live />;
}
