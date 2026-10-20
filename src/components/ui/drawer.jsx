"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { cn } from "@/lib/utils";

// Side panel. Same focus trap, Escape and backdrop click as Dialog, pinned to
// a viewport edge instead of centred.
const SIDES = {
  right:
    "right-0 border-l data-open:slide-in-from-right data-closed:slide-out-to-right",
  left: "left-0 border-r data-open:slide-in-from-left data-closed:slide-out-to-left",
};

function Drawer({ ...props }) {
  return <DialogPrimitive.Root data-slot="drawer" {...props} />;
}

function DrawerTrigger({ ...props }) {
  return <DialogPrimitive.Trigger data-slot="drawer-trigger" {...props} />;
}

function DrawerClose({ ...props }) {
  return <DialogPrimitive.Close data-slot="drawer-close" {...props} />;
}

function DrawerContent({ side = "right", className, children, ...props }) {
  // A drawer opened over a modal (`z-[75]`) lifts its backdrop to the same layer, as Dialog does.
  const layer = typeof className === "string" ? className.match(/(?:^|\s)(z-\[\d+\])/)?.[1] : undefined;
  return (
    <DialogPrimitive.Portal data-slot="drawer-portal">
      <DialogPrimitive.Backdrop
        data-slot="drawer-overlay"
        forceRender
        className={cn(
          "fixed inset-0 isolate z-50 bg-black/40 backdrop-blur-sm duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fill-mode-forwards data-closed:fade-out-0",
          layer,
        )}
      />
      <DialogPrimitive.Popup
        data-slot="drawer-content"
        className={cn(
          "fixed top-0 z-50 flex h-full w-[500px] max-w-full flex-col border-border bg-card text-foreground shadow-2xl outline-none duration-300 data-open:animate-in data-closed:animate-out data-closed:fill-mode-forwards",
          SIDES[side],
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

function DrawerTitle({ className, ...props }) {
  return (
    <DialogPrimitive.Title
      data-slot="drawer-title"
      className={cn("font-heading text-base font-medium", className)}
      {...props}
    />
  );
}

function DrawerDescription({ className, ...props }) {
  return (
    <DialogPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DrawerTrigger,
};
