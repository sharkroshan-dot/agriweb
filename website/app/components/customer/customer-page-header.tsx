import { ReactNode } from "react";
import { cn } from "../../lib/utils";

type CustomerPageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
};

export function CustomerPageHeader({ eyebrow, title, description, actions, className }: CustomerPageHeaderProps) {
  return (
    <header className={cn("customer-page-header", className)}>
      <div className="min-w-0">
        {eyebrow && <p className="customer-page-eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="customer-page-description">{description}</p>}
      </div>
      {actions && <div className="customer-page-actions">{actions}</div>}
    </header>
  );
}
