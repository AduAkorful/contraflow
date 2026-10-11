import { redirect } from "next/navigation";

/// The Overview is the signed-in `/app` page; this address is a common guess for it.
export default function OverviewRedirect() {
  redirect("/app");
}
