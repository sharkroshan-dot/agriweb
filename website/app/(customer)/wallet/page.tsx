import { redirect } from "next/navigation";

export default function CustomerWalletRedirect() {
  redirect("/payments");
}
