"use client";

import * as React from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { XIcon } from "lucide-react";

function Dialog({ ...props }) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({ className, ...props }) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      forceRender
      className={cn(
        "fixed inset-0 isolate z-[80] bg-black/30 backdrop-blur-sm duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fill-mode-forwards data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  sheet = true,
  ...props
}) {
  // Every dialog sits on the dialog layer, z-[80], above the record windows (z-[70],
  // ModalShell and RecordModalContent) and slide-overs opened over them (z-[75]), so
  // one opened from a record window shows on top of it (#929). Dropdowns, selects,
  // tooltips and toasts sit far above (z-[10001] and up). A dialog with its own layer
  // (`z-[70]` for a record window) lifts or lowers its backdrop to match, so the
  // backdrop always dims what is beneath the dialog, never the dialog itself.
  const layer = typeof className === "string" ? className.match(/(?:^|\s)(z-\[\d+\])/)?.[1] : undefined;
  return (
    <DialogPortal>
      <DialogOverlay className={layer} />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-[80] grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 max-h-[calc(100vh-2rem)] supports-[height:1dvh]:max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-lg",
          // Phones (below 640px): a full-height sheet, inset 0, rounded top corners (#980).
          // Header and footer stay pinned (they are sticky) while the body scrolls. A
          // flex column here so the footer can sit at the bottom of a short form.
          sheet &&
            "max-md:!top-0 max-md:!left-0 max-md:!translate-x-0 max-md:!translate-y-0 max-md:!h-dvh max-md:!max-h-none max-md:!w-full max-md:!max-w-none max-md:flex max-md:flex-col max-md:rounded-t-2xl max-md:rounded-b-none max-md:[&>*]:shrink-0",
          " data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fill-mode-forwards data-closed:fade-out-0 data-closed:zoom-out-95",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }) {
  return (
    <div
      data-slot="dialog-header"
      className={cn(
        // Pinned: stays at the top of the dialog while the body scrolls (#980).
        "sticky top-0 z-10 -mx-4 -mt-4 flex flex-col gap-2 bg-popover px-4 pt-4 pb-2",
        className,
      )}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "sticky bottom-0 z-10 -mx-4 -mb-4 mt-0 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted p-4 max-md:mt-auto max-md:rounded-b-none max-md:pb-[calc(1rem+env(safe-area-inset-bottom))] md:flex-row md:justify-end",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className,
      )}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
