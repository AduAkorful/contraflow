/// Anything under /api/v1 that no endpoint claims. API clients get the API's JSON error shape, never
/// the site's HTML 404 page. Specific routes win over this catch-all.
function notFound(): Response {
  return Response.json(
    { error: { code: "not_found", message: "No such API endpoint." } },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
