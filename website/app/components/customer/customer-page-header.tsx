import type { ReactNode } from "react";
import { PageHeader } from "../common/page-header";

type CustomerPageHeaderProps = { eyebrow?: string; title: string; description?: string; actions?: ReactNode; className?: string };

export function CustomerPageHeader({ eyebrow, title, description, actions, className }: CustomerPageHeaderProps) {
  return <PageHeader className={["customer-page-header", className].filter(Boolean).join(" ")} eyebrow={eyebrow} title={title} description={description} actions={actions} />;
}
