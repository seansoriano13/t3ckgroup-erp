import { Maximize2, X, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LogTaskHeader({ user, isExpanded, onToggleExpand, onClose }) {
  return (
    <div className="flex items-center justify-between px-5 pt-4 pb-2 border-b border-mauve-3/40 shrink-0">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <div className="w-[18px] h-[18px] rounded flex items-center justify-center bg-primary text-primary-foreground font-bold text-[9px] shrink-0">
          {user?.department?.charAt(0)?.toUpperCase() || "T"}
        </div>
        <ChevronDown size={11} className="text-mauve-6 -rotate-90deg" />
        <span className="font-medium text-muted-foreground/80">New Task</span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          onClick={onToggleExpand}
          variant="ghost" size="icon-xs"
          title={isExpanded ? "Collapse" : "Expand"}
        >
          <Maximize2 size={14} />
        </Button>
        <Button
          type="button"
          onClick={onClose}
          variant="ghost" size="icon-xs"
        >
          <X size={15} />
        </Button>
      </div>
    </div>
  );
}
