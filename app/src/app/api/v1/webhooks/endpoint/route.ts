import { deleteWebhookEndpoint, getWebhookEndpoint, setWebhookEndpoint } from "@/src/api/handlers";
import { apiMethods } from "@/src/api/http";

export const { GET, POST, PUT, PATCH, DELETE, OPTIONS } = apiMethods({
  GET: getWebhookEndpoint,
  POST: setWebhookEndpoint,
  DELETE: deleteWebhookEndpoint,
});
