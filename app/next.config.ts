import type { NextConfig } from "next";

/// Headers every response carries. The CSP is deliberately the non-script subset: pages load Privy,
/// WalletConnect, Circle Gateway and per-chain RPC endpoints, and an enumerated script-src/connect-src
/// would break a wallet flow when any of them adds an origin. These directives stop framing,
/// plugin content, base-tag injection and cross-origin form posts without touching any of that.
const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
