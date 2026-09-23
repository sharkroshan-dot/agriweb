"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "../../lib/utils";

interface DropdownMenuProps {
  children: React.ReactNode;
}

export function DropdownMenu({ children }: DropdownMenuProps) {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLDivElement>(null);

  const childArray = React.Children.toArray(children);
  const trigger = childArray.find((child) => React.isValidElement(child) && child.type === DropdownMenuTrigger);
  const content = childArray.find((child) => React.isValidElement(child) && child.type === DropdownMenuContent);

  if (!trigger || !content) return null;

  return (
    <div className="relative" ref={triggerRef}>
      {React.cloneElement(trigger as React.ReactElement<any>, {
        onClick: () => setOpen((prev) => !prev),
      })}
      {open ? <div className="absolute right-0 z-50 mt-2 min-w-[180px] rounded-md border bg-white p-1 shadow-lg">{content}</div> : null}
    </div>
  );
}

export function DropdownMenuTrigger({
  children,
  className,
  asChild = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp className={cn("inline-flex items-center", className)} {...props}>
      {children}
    </Comp>
  );
}

export function DropdownMenuContent({ children, className }: React.HTMLAttributes<HTMLDivElement> & { align?: "start" | "end" }) {
  return <div className={cn("space-y-1", className)}>{children}</div>;
}

export function DropdownMenuItem({
  children,
  className,
  asChild = false,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp className={cn("flex w-full items-center rounded-md px-3 py-2 text-sm text-slate-700 hover:bg-slate-100", className)} {...props}>
      {children}
    </Comp>
  );
}

export function DropdownMenuLabel({ children, className }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500", className)}>{children}</div>;
}

export function DropdownMenuSeparator() {
  return <div className="my-1 h-px bg-slate-200" />;
}
