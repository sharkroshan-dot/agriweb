import { redirect } from "next/navigation";

/**
 * Farmer quote review and selection now lives inside each RFQ.
 * Keep the old URL working for bookmarks, but send Business users to My RFQs.
 */
export default function BusinessQuotesRedirect() {
  redirect("/business/rfqs");
}
