import { ReactNode } from "react";
import { Warehouse } from "lucide-react";
import { cn } from "../../lib/utils";

type WarehousePageHeaderProps = {
  title: string;
  description: string;
  eyebrow?: string;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
};

export function WarehousePageHeader({ title, description, eyebrow = "Warehouse operations", actions, meta, className }: WarehousePageHeaderProps) {
  return (
    <header className={cn("warehouse-page-header", className)}>
      <div className="flex min-w-0 items-start gap-3">
        <div className="warehouse-page-header-icon" aria-hidden="true"><Warehouse className="h-5 w-5" /></div>
        <div className="min-w-0">
          <p className="warehouse-page-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="warehouse-page-description">{description}</p>
          {meta && <div className="warehouse-page-meta">{meta}</div>}
        </div>
      </div>
      {actions && <div className="warehouse-page-actions">{actions}</div>}
    </header>
  );
}
