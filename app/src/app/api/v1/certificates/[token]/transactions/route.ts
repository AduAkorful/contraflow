import { recoverReportTransaction, reportTransaction } from "../../../../../../src/api/handlers";
import { route } from "../../../../../../src/api/http";

export const POST = route(reportTransaction, { recoverFromEffect: recoverReportTransaction });
