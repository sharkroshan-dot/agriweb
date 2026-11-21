import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, ClipboardList, Plus } from "lucide-react";
import { Button } from "../ui/button";
import { PageHeader } from "../common/page-header";

type Props = { eyebrow?: string; title: string; description: string; actionHref?: string; actionLabel?: string; actionIcon?: "plus" | "arrow"; children?: ReactNode };

export function FarmerPageHeader({ eyebrow = "Farm operations", title, description, actionHref, actionLabel, actionIcon = "arrow", children }: Props) {
  return <PageHeader className="farmer-page-header" icon={<ClipboardList className="h-3.5 w-3.5" />} eyebrow={eyebrow} title={title} description={description} actions={<>{children}{actionHref && actionLabel && <Button asChild className="min-h-10 bg-emerald-600 shadow-sm hover:bg-emerald-700"><Link href={actionHref}>{actionIcon === "plus" ? <Plus className="mr-2 h-4 w-4" /> : <ArrowRight className="mr-2 h-4 w-4" />}{actionLabel}</Link></Button>}</>} />;
}
