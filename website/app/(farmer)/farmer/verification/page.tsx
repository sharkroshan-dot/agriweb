import { redirect } from "next/navigation";

export default function VerificationRedirectPage() {
  redirect("/farmer/agri-score");
}