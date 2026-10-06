/// Cursor pagination for GET /parties/{address}/obligations. The three lists are concatenated in a
/// stable order (proposals, then obligations, then certificates, each by id) so a page never mixes
/// kinds in an undefined way.

import { ApiError } from "./auth";

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;

export type ListKind = "proposal" | "obligation" | "certificate";

const KIND_ORDER: Record<ListKind, number> = { proposal: 0, obligation: 1, certificate: 2 };

export function parsePageLimit(query: URLSearchParams): number {
  const raw = query.get("limit");
  if (raw === null || raw === "") return DEFAULT_PAGE_LIMIT;
  if (!/^\d+$/.test(raw)) throw new ApiError(422, "invalid_request", "limit must be a positive integer.");
  const n = Number(raw);
  if (n < 1 || n > MAX_PAGE_LIMIT) {
    throw new ApiError(422, "invalid_request", `limit must be between 1 and ${MAX_PAGE_LIMIT}.`);
  }
  return n;
}

export function parsePageCursor(query: URLSearchParams): string | null {
  const raw = query.get("cursor");
  if (raw === null || raw === "") return null;
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) throw new ApiError(422, "invalid_request", "cursor is not valid.");
  return raw;
}

function encodeCursor(kind: ListKind, id: string): string {
  return Buffer.from(`${kind}:${id}`, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): { kind: ListKind; id: string } | null {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const sep = decoded.indexOf(":");
  if (sep <= 0) return null;
  const kind = decoded.slice(0, sep);
  const id = decoded.slice(sep + 1);
  if (kind !== "proposal" && kind !== "obligation" && kind !== "certificate") return null;
  if (!id) return null;
  return { kind, id };
}

function compareItems(a: { kind: ListKind; id: string }, b: { kind: ListKind; id: string }): number {
  const kindDiff = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (kindDiff !== 0) return kindDiff;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function paginatePartyLists<P extends { token: string }, O extends { obligationId: string }, C extends { token: string }>(
  proposals: P[],
  obligations: O[],
  certificates: C[],
  limit: number,
  cursor: string | null,
): { proposals: P[]; obligations: O[]; certificates: C[]; nextCursor: string | null } {
  const items: Array<{ kind: ListKind; id: string; value: P | O | C }> = [
    ...proposals.map((value) => ({ kind: "proposal" as const, id: value.token, value })),
    ...obligations.map((value) => ({ kind: "obligation" as const, id: value.obligationId, value })),
    ...certificates.map((value) => ({ kind: "certificate" as const, id: value.token, value })),
  ].sort(compareItems);

  let start = 0;
  if (cursor) {
    const decoded = decodeCursor(cursor);
    if (!decoded) throw new ApiError(422, "invalid_request", "cursor is not valid.");
    const idx = items.findIndex((item) => item.kind === decoded.kind && item.id === decoded.id);
    start = idx === -1 ? items.length : idx + 1;
  }

  const page = items.slice(start, start + limit);
  const last = page[page.length - 1];
  const nextCursor = start + page.length < items.length && last ? encodeCursor(last.kind, last.id) : null;

  return {
    proposals: page.filter((i) => i.kind === "proposal").map((i) => i.value as P),
    obligations: page.filter((i) => i.kind === "obligation").map((i) => i.value as O),
    certificates: page.filter((i) => i.kind === "certificate").map((i) => i.value as C),
    nextCursor,
  };
}
