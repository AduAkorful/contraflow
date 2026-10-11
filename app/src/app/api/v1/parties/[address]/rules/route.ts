import { getPartyRulesHandler, setPartyRulesHandler } from "@/src/api/handlers";
import { apiMethods } from "@/src/api/http";

export const { GET, POST, PUT, PATCH, DELETE, OPTIONS } = apiMethods({
  GET: getPartyRulesHandler,
  POST: setPartyRulesHandler,
});
