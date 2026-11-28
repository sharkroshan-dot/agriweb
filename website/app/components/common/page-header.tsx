import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export type PageHeaderProps = {
  title: string;
  description?: string;
  eyebrow?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  className?: string;
};

/** Consistent title hierarchy and action placement across all workspaces. */
export function PageHeader({ title, description, eyebrow, icon, actions, meta, className }: PageHeaderProps) {
  return (
    <header className={cn("agri-page-header", className)} data-page-header>
      <div className="agri-page-heading">
        {(eyebrow || icon) && <p className="agri-page-eyebrow">{icon && <span className="agri-page-header-icon" aria-hidden="true">{icon}</span>}{eyebrow}</p>}
        <h1 className="agri-page-title">{title}</h1>
        {description && <p className="agri-page-description">{description}</p>}
        {meta && <div className="agri-page-meta">{meta}</div>}
      </div>
      {actions && <div className="agri-page-actions">{actions}</div>}
    </header>
  );
}
