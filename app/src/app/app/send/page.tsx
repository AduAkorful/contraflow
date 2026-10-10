import { redirect } from "next/navigation";

/// Send lives on the Balance page now. Old links and bookmarks land there, keeping a pre-filled
/// recipient.
export default async function SendRedirect({ searchParams }: { searchParams: Promise<{ to?: string | string[] }> }) {
  const to = (await searchParams).to;
  const query = typeof to === "string" ? `&to=${encodeURIComponent(to)}` : "";
  redirect(`/app/balance?tab=send${query}`);
}
