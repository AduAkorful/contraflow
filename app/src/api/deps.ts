/// Production wiring for the API: Postgres, the app's ledger on Arc, and the same obligation and
/// certificate services the web app uses.

import { randomUUID } from "node:crypto";
import { createArcPublicClient } from "../chain/client";
import { ARC_TESTNET_CHAIN_ID } from "../contracts/addresses";
import { claimIdempotency, completeIdempotency, completeIdempotencyFromEffect, postgresTenantStore, tagProposalTenant } from "../db/tenants";
import { appLedgerDomain } from "../netting/domain";
import { certificateService } from "../obligations/certificateDefaults";
import * as obligations from "../obligations/service";
import type { ApiDeps } from "./handlers";

let cached: ApiDeps | undefined;

export function apiDeps(): ApiDeps {
  cached ??= {
    store: postgresTenantStore,
    client: createArcPublicClient(ARC_TESTNET_CHAIN_ID),
    domain: appLedgerDomain(),
    nowSeconds: () => BigInt(Math.floor(Date.now() / 1000)),
    newId: () => randomUUID(),
    obligations,
    certificates: certificateService(),
    tagProposal: tagProposalTenant,
  };
  return cached;
}

export const idempotency = {
  claim: claimIdempotency,
  complete: completeIdempotency,
  completeFromEffect: completeIdempotencyFromEffect,
};
