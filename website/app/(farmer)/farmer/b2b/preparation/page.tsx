import { redirect } from "next/navigation";

// Backward-compatible route: recurring contract management and preparation
// now live together in the B2B Supply Workspace.
export default function FarmerB2bPreparationRedirect() {
  redirect("/farmer/b2b/contracts");
}
