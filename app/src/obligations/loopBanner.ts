/// Which open certificate the "these obligations form a loop" banner should open: prefer one
/// the caller still needs to sign, then one that's ready to apply, then any other collecting
/// certificate, then a token just found by search.

export function loopBannerTarget<T extends { token: string; status: string; youSigned: boolean }>(
  certificates: readonly T[],
  foundToken: string | null,
): string | null {
  const open = certificates.filter((c) => c.status === "collecting" || c.status === "ready");
  const unsigned = open.find((c) => c.status === "collecting" && !c.youSigned);
  if (unsigned) return unsigned.token;
  const ready = open.find((c) => c.status === "ready");
  if (ready) return ready.token;
  if (open[0]) return open[0].token;
  return foundToken;
}
