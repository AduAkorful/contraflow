import { recoverSignCertificate, signCertificate } from "../../../../../../src/api/handlers";
import { route } from "../../../../../../src/api/http";

export const POST = route(signCertificate, { recoverFromEffect: recoverSignCertificate });
