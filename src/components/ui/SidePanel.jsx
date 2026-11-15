import { useState } from "react";
import { cn } from "../../lib/utils";
import { Button } from "./button";
import { Drawer, DrawerContent, DrawerTitle, DrawerTrigger, DrawerClose } from "./drawer";
import { X } from "lucide-react";
import { useIsPhone, useRoomy } from "@/hooks/useScreenBand";


/**
 * A side column that is not the page's main job. Wide and tall enough, it is a
 * right-hand column. Otherwise it is a trigger that opens the same content in a
 * right Drawer (768px and up) or a bottom sheet (phones).
 *
 * The content is rendered in exactly one place at a time, so its queries never
 * run twice. Off the inline mode it mounts only while the drawer is open.
 */
export default function SidePanel({
  label,
  icon: Icon,
  badge,
  inlineFrom = 1440,
  width = "22rem",
  open: openProp,
  onOpenChange,
  trigger = "button",
  className,
  layer,
  children,
}) {
  const roomy = useRoomy(inlineFrom);
  const phone = useIsPhone();
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next) => {
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };

  if (roomy) {
    return (
      <aside
        data-slot="side-panel"
        aria-label={label}
        style={{ width }}
        className={cn("flex min-h-0 shrink-0 flex-col", className)}
      >
        {children}
      </aside>
    );
  }

  const sticky = trigger === "sticky" && phone;
  const content = (
    <>
      <span className="flex items-center gap-2">
        {Icon ? <Icon className="size-4" aria-hidden /> : null}
        <span>{label}</span>
      </span>
      {badge != null && badge !== false && badge !== 0 ? (
        <span
          data-slot="side-panel-badge"
          className="rounded-full bg-foreground px-1.5 text-[11px] font-semibold leading-5 text-background"
        >
          {badge}
        </span>
      ) : null}
    </>
  );

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      {sticky ? (
        <div
          data-slot="side-panel-bar"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        >
          <DrawerTrigger
            render={<Button type="button" variant="outline" className="h-auto min-h-9 w-full justify-between whitespace-normal py-1.5 text-left" />}
          >
            {content}
          </DrawerTrigger>
        </div>
      ) : (
        <DrawerTrigger
          render={<Button type="button" variant="outline" size="sm" className="gap-2" />}
        >
          {content}
        </DrawerTrigger>
      )}
      <DrawerContent
        side={phone ? "bottom" : "right"}
        style={phone ? undefined : { width }}
        className={cn(layer, !phone && "max-w-[90vw]")}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <DrawerTitle>{label}</DrawerTitle>
          <DrawerClose render={<Button type="button" variant="ghost" size="icon-sm" aria-label={`Close ${label}`} />}>
            <X className="size-4" aria-hidden />
          </DrawerClose>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{children}</div>
      </DrawerContent>
    </Drawer>
  );
}
