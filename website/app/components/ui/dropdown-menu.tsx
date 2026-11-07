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

  React.useEffect(() => {
    if (!open) return;

    // Close the menu whenever the user clicks or taps outside the trigger/menu.
    // The trigger and popup share this wrapper, so clicks within either remain open.
    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !triggerRef.current?.contains(target)) {
        setOpen(false);
      }
    };

    // Match native dropdown behavior for keyboard users.
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  if (!trigger || !content) return null;

  return (
    <div className="relative" ref={triggerRef}>
      {React.cloneElement(trigger as React.ReactElement<any>, {
        onClick: () => setOpen((prev) => !prev),
      })}
      {open ? <div className="absolute right-0 z-50 mt-2 min-w-[180px] rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">{content}</div> : null}
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
    <Comp className={cn("flex w-full items-center rounded-lg px-3 py-2 text-sm text-slate-700 transition-colors hover:bg-emerald-50 hover:text-emerald-700", className)} {...props}>
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
