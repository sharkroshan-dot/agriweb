import type { ReactNode } from "react";
import { Warehouse } from "lucide-react";
import { cn } from "../../lib/utils";
import { PageHeader } from "../common/page-header";

type Props = { title: string; description: string; eyebrow?: string; actions?: ReactNode; meta?: ReactNode; className?: string };

export function WarehousePageHeader({ title, description, eyebrow = "Warehouse operations", actions, meta, className }: Props) {
  return <PageHeader className={cn("warehouse-page-header", className)} icon={<Warehouse className="h-3.5 w-3.5" />} eyebrow={eyebrow} title={title} description={description} meta={meta} actions={actions} />;
}
