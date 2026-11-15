import { Link2 } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Copies the address of the open window (window.location.href). A window that
// has an address (spec #1013) is shared by pasting it, so this is the one
// "Copy link" every record header uses.
async function copyCurrentLink() {
  const href = window.location.href;
  try {
    await navigator.clipboard.writeText(href);
    toast.success("Link copied");
  } catch {
    toast.error("Could not copy the link");
  }
}

export default function CopyLinkButton({ className, size = "icon-sm", iconSize = 14, ...props }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size={size}
      onClick={copyCurrentLink}
      title="Copy link"
      aria-label="Copy link"
      className={cn("text-muted-foreground transition-colors hover:text-foreground", className)}
      {...props}
    >
      <Link2 size={iconSize} />
    </Button>
  );
}
