import {
  createPermission,
  listPermissions,
} from "@/src/api/handlers";
import { apiMethods } from "@/src/api/http";

export const { GET, POST, PUT, PATCH, DELETE, OPTIONS } = apiMethods({
  GET: listPermissions,
  POST: { handler: createPermission, options: { recoverStaleIdempotency: true } },
});
