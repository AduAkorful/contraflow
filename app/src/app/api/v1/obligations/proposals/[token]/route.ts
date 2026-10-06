import { getObligationProposal, withdrawObligationProposal } from "../../../../../../src/api/handlers";
import { route } from "../../../../../../src/api/http";

export const GET = route(getObligationProposal);
export const DELETE = route(withdrawObligationProposal);
