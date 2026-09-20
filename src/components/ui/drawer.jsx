"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { cn } from "@/lib/utils";

const SIDES = {
  right: "inset-y-0 right-0 h-full w-full max-w-md border-l data-[starting-style]:translate-x-full data-[ending-style]:translate-x-full",
  left: "inset-y-0 left-0 h-full w-full max-w-md border-r data-[starting-style]:-translate-x-full data-[ending-style]:-translate-x-full",
};

// A panel that slides in from a screen edge over a dimmed backdrop. Focus is
// trapped inside while open; Escape and a backdrop click ask to close through
// onOpenChange(false). It is a Dialog in behavior, positioned as a side panel.
function Drawer({ open, onOpenChange, side = "right", className, children, ...props }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} data-slot="drawer">
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          data-slot="drawer-overlay"
          className="fixed inset-0 isolate z-50 bg-black/40 backdrop-blur-sm transition-opacity duration-300 data-[starting-style]:opacity-0 data-[ending-style]:opacity-0"
        />
        <DialogPrimitive.Popup
          data-slot="drawer-content"
          className={cn(
            "fixed z-50 flex flex-col border-border bg-card text-card-foreground shadow-2xl outline-none transition-transform duration-300 ease-in-out",
            SIDES[side],
            className,
          )}
          {...props}
        >
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function DrawerTitle({ className, ...props }) {
  return <DialogPrimitive.Title data-slot="drawer-title" className={className} {...props} />;
}

function DrawerClose({ ...props }) {
  return <DialogPrimitive.Close data-slot="drawer-close" {...props} />;
}

export { Drawer, DrawerTitle, DrawerClose };
