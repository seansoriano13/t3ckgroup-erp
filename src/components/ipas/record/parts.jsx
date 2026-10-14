// The small pieces the record page shares: the caption that names a group.

import { CAPTION_BASE } from "@/lib/captionStyle";
import { cn } from "@/lib/utils";

/** The house label: small, bold, uppercase. Names the group the content under it belongs to. */
export function Caption({ children, className }) {
  return <p className={cn(CAPTION_BASE, "tracking-wider text-muted-foreground", className)}>{children}</p>;
}
