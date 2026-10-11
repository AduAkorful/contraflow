import { describe, expect, it } from "vitest";
import { apiBriefMarkdown, llmsTxt } from "../src/agent/apiBrief";
import { ERROR_CODES, OPENAPI } from "../src/api/openapi";
import { WEBHOOK_EVENT_TYPES } from "../src/api/webhooks";

const brief = apiBriefMarkdown();

describe("API brief for agents", () => {
  it("lists every operation, error code and webhook type the API has", () => {
    const paths = OPENAPI.paths as Record<string, Record<string, { operationId: string }>>;
    for (const [path, methods] of Object.entries(paths)) {
      for (const [method, spec] of Object.entries(methods)) {
        expect(brief, `${method} ${path}`).toContain(`\`${method.toUpperCase()} ${path}\``);
        expect(brief).toContain(`\`${spec.operationId}\``);
      }
    }
    for (const code of ERROR_CODES) expect(brief).toContain(`\`${code}\``);
    for (const type of WEBHOOK_EVENT_TYPES) expect(brief).toContain(`\`${type}\``);
  });

  it("states the rules an integrating agent must follow", () => {
    expect(brief).toMatch(/never signs for anyone/i);
    expect(brief).toMatch(/Idempotency-Key/);
    expect(brief).toMatch(/\bbigint\b/);
    expect(brief).toMatch(/does not by itself discharge a debt/);
    expect(brief).toMatch(/Never ask for, print, log or commit secrets/);
  });

  it("carries no secret-looking values or banned claims", () => {
    for (const text of [brief, llmsTxt()]) {
      expect(text).not.toMatch(/cfk_(test|live)_[A-Za-z0-9_-]{8,}/);
      expect(text).not.toMatch(/whsec_[A-Za-z0-9_-]{20,}/);
      expect(text).not.toMatch(/0x[0-9a-fA-F]{64}\b/);
      expect(text).not.toMatch(/open[- ]source|hackathon|on-chain/i);
    }
  });

  it("links the index to the brief and the OpenAPI document", () => {
    const index = llmsTxt();
    expect(index.startsWith("# Contraflow")).toBe(true);
    expect(index).toContain("/contraflow-api.md");
    expect(index).toContain("/openapi.json");
  });
});
