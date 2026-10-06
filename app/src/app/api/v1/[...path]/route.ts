/// Anything under /api/v1 that no endpoint claims. API clients get the API's JSON error shape, never
/// the site's HTML 404 page. Specific routes win over this catch-all.

import { preflight, publicReply } from "@/src/api/http";

function notFound(request: Request): Response {
  return publicReply(request, 404, { error: { code: "not_found", message: "No such API endpoint." } }, "OPTIONS");
}

export function OPTIONS(request: Request) {
  return preflight(request, "OPTIONS");
}

export function GET(request: Request) {
  return notFound(request);
}
export function POST(request: Request) {
  return notFound(request);
}
export function PUT(request: Request) {
  return notFound(request);
}
export function PATCH(request: Request) {
  return notFound(request);
}
export function DELETE(request: Request) {
  return notFound(request);
}
