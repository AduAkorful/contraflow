import { revokePermission } from "../../../../../src/api/handlers";
import { route } from "../../../../../src/api/http";

export const DELETE = route(revokePermission);
