/// Whether a wallet error is the user declining the request. wagmi and viem wrap the provider's
/// error, so the code (4001, or ACTION_REJECTED from ethers-style wallets) and the name can sit a
/// few causes down; checking only the top-level code mistook a declined request for a lost one.

const REJECTED_MESSAGE = /user (rejected|denied)|rejected the request|request (was )?rejected|cancell?ed/i;

export function isUserRejection(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current && typeof current === "object"; depth++) {
    const { code, name, message, cause } = current as {
      code?: unknown;
      name?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (code === 4001 || code === "ACTION_REJECTED") return true;
    if (name === "UserRejectedRequestError") return true;
    if (typeof message === "string" && REJECTED_MESSAGE.test(message)) return true;
    current = cause;
  }
  return false;
}
