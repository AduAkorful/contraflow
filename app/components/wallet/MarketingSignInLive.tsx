"use client";

import { Providers } from "@/src/app/app/providers";
import { SignInMenu } from "./SignInMenu";

/// Loaded only after Sign in is clicked on a marketing page.
export function MarketingSignInLive() {
  return (
    <Providers sessionAddress={null} initialMenuOpen>
      <SignInMenu initialOpen />
    </Providers>
  );
}
