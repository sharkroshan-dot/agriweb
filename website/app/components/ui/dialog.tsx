"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  wide?: boolean;
  children: React.ReactNode;
}

export function Dialog({ open = false, onOpenChange, wide = false, children }: DialogProps) {
  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange?.(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  if (!open || typeof document === "undefined") return null;

  const dialog = (
    <div
      className="fixed inset-0 z-[1000] flex min-h-screen items-center justify-center bg-slate-950/55 p-4 backdrop-blur-[2px]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onOpenChange?.(false);
      }}
    >
      <div className={`relative max-h-[calc(100vh-2rem)] w-full ${wide ? "max-w-2xl" : "max-w-lg"} overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl sm:p-7`}>
        {onOpenChange && (
          <button
            type="button"
            aria-label="Close"
            onClick={() => onOpenChange(false)}
            className="absolute right-4 top-4 rounded-full p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        {children}
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}

export function DialogContent({ className, children }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-4", className)}>{children}</div>;
}

export function DialogHeader({ className, children }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-1", className)}>{children}</div>;
}

export function DialogTitle({ className, children }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-lg font-semibold", className)}>{children}</h2>;
}

export function DialogDescription({ className, children }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-slate-500", className)}>{children}</p>;
}
