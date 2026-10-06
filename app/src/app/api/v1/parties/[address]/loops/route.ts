import { findLoop, recoverFindLoop } from "@/src/api/handlers";
import { apiMethods } from "@/src/api/http";

export const { GET, POST, PUT, PATCH, DELETE, OPTIONS } = apiMethods({
  POST: { handler: findLoop, options: { recoverFromEffect: recoverFindLoop } },
});
