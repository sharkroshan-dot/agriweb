import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "../ui/button";
import { PageHeader } from "../common/page-header";

type Props = { title: string; description: string; eyebrow?: string; actionHref?: string; actionLabel?: string; children?: ReactNode };

export function AdminPageHeader({ title, description, eyebrow = "Enterprise operations", actionHref, actionLabel, children }: Props) {
  return <PageHeader className="admin-page-header" icon={<ShieldCheck className="h-3.5 w-3.5" />} eyebrow={eyebrow} title={title} description={description} actions={<>{children}{actionHref && actionLabel && <Button asChild className="min-h-10 bg-emerald-600 hover:bg-emerald-700"><Link href={actionHref}><ArrowRight className="mr-2 h-4 w-4" />{actionLabel}</Link></Button>}</>} />;
}
