import { OPENAPI } from "@/src/api/openapi";
import { methodNotAllowed, preflight, publicReply } from "@/src/api/http";

const ALLOW = "GET, OPTIONS";

export function GET(request: Request) {
  return publicReply(request, 200, OPENAPI, ALLOW);
}

export function OPTIONS(request: Request) {
  return preflight(request, ALLOW);
}

export function POST(request: Request) {
  return methodNotAllowed(request, ALLOW);
}
export function PUT(request: Request) {
  return methodNotAllowed(request, ALLOW);
}
export function PATCH(request: Request) {
  return methodNotAllowed(request, ALLOW);
}
export function DELETE(request: Request) {
  return methodNotAllowed(request, ALLOW);
}
