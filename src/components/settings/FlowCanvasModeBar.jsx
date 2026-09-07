import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Live/Sandbox, floating over the canvas rather than a second page (this
 * reshape) — both modes render the same `FlowCanvas`; this only ever
 * switches which data provider it's wrapped in.
 *
 * Positioned top-left: the Sale Type toolbar is centered (`justify-evenly`
 * across the full width) and the MiniMap sits top-right, so this corner is
 * the one nothing else on the canvas already claims.
 */
export default function FlowCanvasModeBar({ mode, onModeChange, canSeeHistory, onOpenHistory }) {
  return (
    <div className="pointer-events-none absolute left-3 top-3 z-30 flex items-center gap-2">
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-2xl bg-card/85 p-1 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_28px_-18px_rgba(0,0,0,0.4)] backdrop-blur-md">
        <ModeButton active={mode === "live"} onClick={() => onModeChange("live")}>
          Live
        </ModeButton>
        <ModeButton active={mode === "sandbox"} accent onClick={() => onModeChange("sandbox")}>
          Sandbox
        </ModeButton>
      </div>

      {mode === "live" && canSeeHistory && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="pointer-events-auto gap-1.5 rounded-2xl bg-card/85 backdrop-blur-md"
          onClick={onOpenHistory}
        >
          <History size={14} /> Snapshot History
        </Button>
      )}
    </div>
  );
}

function ModeButton({ active, accent, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-xl px-3 py-1.5 text-xs font-bold transition-colors",
        active
          ? accent
            ? "bg-amber-4 text-amber-11"
            : "bg-mauve-4 text-foreground"
          : "text-muted-foreground hover:bg-mauve-a3",
      )}
    >
      {children}
    </button>
  );
}
