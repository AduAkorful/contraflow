import { acceptObligationProposal, recoverAcceptObligationProposal } from "../../../../../../../src/api/handlers";
import { route } from "../../../../../../../src/api/http";

export const POST = route(acceptObligationProposal, { recoverFromEffect: recoverAcceptObligationProposal });
