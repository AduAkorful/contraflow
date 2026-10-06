import { APP_CHAIN_ID } from "../../src/contracts/addresses";
import { testNetworkNotice } from "../../src/chain/networkNotice";

export function NetworkNotice({ className }: { className?: string } = {}) {
  const notice = testNetworkNotice(APP_CHAIN_ID);
  if (!notice) return null;
  return (
    <p className={className ?? "text-center text-sm text-muted"} role="status">
      {notice}
    </p>
  );
}
