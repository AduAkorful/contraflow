import { isAddress } from "viem";
import { getSession } from "../../../src/session/getSession";
import { HistoryClient } from "./HistoryClient";

/// `?address=` makes a lookup a shareable link. Without one, a signed-in visitor lands on their own
/// history. Anyone else gets the empty form: this page stays open to people with no account.
export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ address?: string | string[] }> }) {
  const requested = (await searchParams).address;
  const fromLink = typeof requested === "string" && isAddress(requested.trim(), { strict: false }) ? requested.trim() : "";
  const session = fromLink ? null : await getSession();
  return <HistoryClient initialAddress={fromLink || session?.address || ""} />;
}
