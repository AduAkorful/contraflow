/// Production wiring for the API: Postgres, the app's ledger on Arc, and the same obligation and
/// certificate services the web app uses.

import { randomUUID } from "node:crypto";
import { createArcPublicClient } from "../chain/client";
import { ARC_TESTNET_CHAIN_ID } from "../contracts/addresses";
import { claimIdempotency, completeIdempotency, completeIdempotencyFromEffect, postgresTenantStore, tagProposalTenant } from "../db/tenants";
import { postgresTenantWebhookStore } from "../db/tenantWebhook";
import { getTenantUsage, recordUsage } from "../db/usage";
import { enqueueWebhookTest, listTenantEvents, postgresWebhookStore } from "../db/webhooks";
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
    enqueueWebhookTest,
    estimateApply: async ({ to, data, from }) => {
      const client = createArcPublicClient(ARC_TESTNET_CHAIN_ID);
      const [gas, gasPrice] = await Promise.all([client.estimateGas({ account: from, to, data }), client.getGasPrice()]);
      return { gas, gasPrice };
    },
    eventLog: {
      list: listTenantEvents,
      canRead: (tenantId, body, nowSeconds) =>
        postgresWebhookStore.hasCurrentReadAccess(
          { eventId: "", tenantId, body, attempts: 0, createdAt: new Date(), url: "", secrets: [] },
          nowSeconds,
        ),
    },
    webhookEndpoint: postgresTenantWebhookStore,
    allowLocalWebhooks: process.env.NODE_ENV !== "production",
    recordUsage,
    getUsage: getTenantUsage,
  };
  return cached;
}

export const idempotency = {
  claim: claimIdempotency,
  complete: completeIdempotency,
  completeFromEffect: completeIdempotencyFromEffect,
};
