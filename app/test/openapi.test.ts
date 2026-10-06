import { describe, expect, it } from "vitest";
import { API_INDEX, ERROR_CODES, OPENAPI } from "../src/api/openapi";
import { WEBHOOK_EVENT_TYPES } from "../src/api/webhooks";

describe("OpenAPI document", () => {
  it("has an operationId, tag and auth errors on every path operation", () => {
    const paths = OPENAPI.paths as Record<string, Record<string, { operationId?: string; tags?: string[]; responses?: Record<string, unknown> }>>;
    for (const [path, methods] of Object.entries(paths)) {
      for (const [method, op] of Object.entries(methods)) {
        expect(op.operationId, `${method.toUpperCase()} ${path}`).toMatch(/^[a-zA-Z]/);
        expect(op.tags, `${method.toUpperCase()} ${path}`).toEqual(expect.arrayContaining([expect.any(String)]));
        expect(op.responses?.["401"], `${method.toUpperCase()} ${path} 401`).toBeTruthy();
        expect(op.responses?.["429"], `${method.toUpperCase()} ${path} 429`).toBeTruthy();
      }
    }
  });

  it("lists a hosted absolute server, CORS-ready relative server, and no invoice API", () => {
    expect(OPENAPI.servers[0]?.url).toMatch(/^https:\/\//);
    expect(OPENAPI.paths).not.toHaveProperty("/invoices");
    expect(JSON.stringify(OPENAPI)).not.toMatch(/\/invoices/);
    expect(API_INDEX.scope).toMatch(/no invoice/i);
  });

  it("enumerates error codes and webhook types from the handlers", () => {
    const codeEnum = (
      OPENAPI.components.schemas.Error as unknown as { properties: { error: { properties: { code: { enum: readonly string[] } } } } }
    ).properties.error.properties.code.enum;
    expect([...codeEnum]).toEqual([...ERROR_CODES]);
    const typeEnum = (OPENAPI.components.schemas.WebhookEvent as unknown as { properties: { type: { enum: readonly string[] } } })
      .properties.type.enum;
    expect([...typeEnum]).toEqual([...WEBHOOK_EVENT_TYPES]);
  });
});
