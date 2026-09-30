import { ChevronLeft, ChevronRight } from "lucide-react";
import Dot from "./ui/Dot";
import { Button } from "@/components/ui/button";

/** Lights up for two seconds when a realtime entry lands. */
export function LiveIndicator({ active }) {
  return (
    <div
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-all duration-300 ${active ? "border-green-a4 bg-green-a2 text-green-11" : "border-transparent bg-transparent text-muted-foreground/60"}`}
    >
      <Dot
        size="w-1.5 h-1.5"
        color={active ? "bg-green-9 shadow-[0_0_8px_var(--green-9)]" : "bg-muted-foreground/40"}
        className={active ? "animate-pulse" : ""}
      />
      <span className="text-[10px] font-bold uppercase tracking-wider">{active ? "New Update" : "Live"}</span>
    </div>
  );
}

/** Newer / Older pager under a log table; `hasMore` is "this page came back full". */
export function LogPager({ page, setPage, hasMore }) {
  return (
    <div className="flex items-center justify-center gap-3 pt-4">
      <Button variant="outline" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
        <ChevronLeft size={14} /> Newer
      </Button>
      <span className="text-[11px] font-bold text-muted-foreground">Page {page + 1}</span>
      <Button variant="outline" onClick={() => setPage((p) => p + 1)} disabled={!hasMore}>
        Older <ChevronRight size={14} />
      </Button>
    </div>
  );
}

/** Failure state shared by the log tables. */
export function LogLoadError({ title, message }) {
  return (
    <div className="rounded-xl border border-red-a5 bg-red-a2 px-5 py-6">
      <p className="text-sm font-black text-red-11">{title}</p>
      <p className="mt-1 text-xs font-medium text-red-11/70">{message || "Unknown error"}</p>
    </div>
  );
}
