import { redirect } from "next/navigation";

export default function BusinessDeliveriesRedirect() {
  redirect("/business/orders");
}
