"use client";

import type { ReactNode } from "react";

export type AgriConnectRole = "customer" | "farmer" | "business" | "warehouse" | "delivery" | "admin";

type RolePageFrameProps = {
  role: AgriConnectRole;
  children: ReactNode;
  className?: string;
};

/** Shared responsive boundary for every authenticated role workspace. */
export function RolePageFrame({ role, children, className = "" }: RolePageFrameProps) {
  return (
    <div className={["agri-role-page", `agri-role-page--${role}`, className].filter(Boolean).join(" ")} data-role-page={role}>
      {children}
    </div>
  );
}
