/// The production wiring for the certificate service: Postgres, the app's ledger on Arc, the real
/// clock, the configured compliance provider and the shared rate limiter.

import { createArcPublicClient } from "../chain/client";
import { defaultComplianceProvider } from "../compliance";
import { ARC_TESTNET_CHAIN_ID } from "../contracts/addresses";
import { postgresCertificateStore } from "../db/certificates";
import { appLedgerDomain } from "../netting/domain";
import { checkRateLimit } from "../ratelimit/limiter";
import { serviceRateLimitKey } from "../api/limitBucket";
import { createCertificateService, type CertificateService } from "./certificates";

const LIMITS = {
  find: { max: 10, windowSeconds: 600 },
  read: { max: 120, windowSeconds: 600 },
  write: { max: 30, windowSeconds: 600 },
} as const;

let cached: CertificateService | undefined;

export function certificateService(): CertificateService {
  cached ??= createCertificateService({
    store: postgresCertificateStore,
    client: createArcPublicClient(ARC_TESTNET_CHAIN_ID),
    domain: appLedgerDomain(),
    now: () => BigInt(Math.floor(Date.now() / 1000)),
    complianceProvider: defaultComplianceProvider(),
    rateLimited: async (kind, address) => {
      const { max, windowSeconds } = LIMITS[kind];
      const result = await checkRateLimit(serviceRateLimitKey("certificates", kind, address), max, windowSeconds);
      return !result.allowed;
    },
  });
  return cached;
}
