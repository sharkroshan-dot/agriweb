import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Briefcase, Plus } from "lucide-react";
import { Button } from "../ui/button";
import { PageHeader } from "../common/page-header";

type Props = { title: string; description: string; eyebrow?: string; actionHref?: string; actionLabel?: string; actionIcon?: "plus" | "arrow"; children?: ReactNode };

export function BusinessPageHeader({ title, description, eyebrow = "B2B procurement", actionHref, actionLabel, actionIcon = "arrow", children }: Props) {
  return <PageHeader className="business-page-header" icon={<Briefcase className="h-3.5 w-3.5" />} eyebrow={eyebrow} title={title} description={description} actions={<>{children}{actionHref && actionLabel && <Button asChild className="min-h-10 bg-emerald-600 shadow-sm hover:bg-emerald-700"><Link href={actionHref}>{actionIcon === "plus" ? <Plus className="mr-2 h-4 w-4" /> : <ArrowRight className="mr-2 h-4 w-4" />}{actionLabel}</Link></Button>}</>} />;
}
