import type { ReactNode, HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

type PageToolbarProps = HTMLAttributes<HTMLDivElement> & { variant?: "surface" | "bare" };

/** Predictable placement for search, filters, tabs and page actions. */
export function PageToolbar({ variant = "surface", className, children, ...props }: PageToolbarProps) {
  return <div className={cn("agri-page-toolbar", variant === "bare" && "agri-page-toolbar--bare", className)} data-page-toolbar {...props}>{children}</div>;
}

type PageSectionProps = {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
};

/** Common section heading and content spacing for dashboard, list and detail pages. */
export function PageSection({ title, description, actions, children, className, contentClassName }: PageSectionProps) {
  return (
    <section className={cn("agri-page-section", className)}>
      {(title || description || actions) && <header className="agri-page-section-header"><div className="min-w-0">{title && <h2 className="agri-page-section-title">{title}</h2>}{description && <p className="agri-page-section-description">{description}</p>}</div>{actions && <div className="agri-page-section-actions">{actions}</div>}</header>}
      <div className={cn("agri-page-section-content", contentClassName)}>{children}</div>
    </section>
  );
}

/** Shared grouping for related form fields and validation messages. */
export function PageFormSection({ title, description, children, className }: PageSectionProps) {
  return (
    <section className={cn("agri-page-form-section", className)} data-form-section>
      {(title || description) && <header className="agri-page-form-section-header">{title && <h2>{title}</h2>}{description && <p>{description}</p>}</header>}
      <div className="agri-page-form-section-content">{children}</div>
    </section>
  );
}
