import { redirect } from "next/navigation";

/**
 * Keep the descriptive URL used by warehouse navigation and older links,
 * while the canonical consolidation workflow remains at /warehouse/consolidation.
 */
export default function MultiWarehouseConsolidationRoute() {
  redirect("/warehouse/consolidation");
}
