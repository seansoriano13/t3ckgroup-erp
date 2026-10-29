import { ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/Tooltip";

/**
 * The Flow Canvas toolbar's Access button (issue #292, part of #208/ADR 0021).
 * It toggles the Access view (FlowAccessPanel) over the canvas.
 */
export default function FlowAccessSettings({ open, onToggle }) {
  return (
    <Tooltip content={open ? "Back to canvas" : "Access settings"}>
      <Button
        variant={open ? "secondary" : "ghost"}
        size="icon-sm"
        aria-label="Access settings"
        aria-pressed={open}
        onClick={onToggle}
      >
        <ShieldCheck size={14} />
      </Button>
    </Tooltip>
  );
}
