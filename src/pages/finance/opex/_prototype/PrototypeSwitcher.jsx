// PROTOTYPE (throwaway): the floating bar that switches between the OPEX redesign options.
import { useEffect } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "../../../../components/ui/button";

export const VARIANTS = [
  { key: "now", name: "Current page" },
  { key: "A", name: "Like IPAS: record window, sections" },
  { key: "B", name: "Like S0 Evaluation: sheet + summary" },
  { key: "C", name: "Like Purchasing Dashboard: side panel" },
];

export function useVariant() {
  const [params] = useSearchParams();
  const v = params.get("variant");
  return VARIANTS.some((x) => x.key === v) ? v : null;
}

export default function PrototypeSwitcher() {
  const [params, setParams] = useSearchParams();
  const current = VARIANTS.findIndex((v) => v.key === (params.get("variant") ?? "now"));
  const index = current < 0 ? 0 : current;

  const go = (step) => {
    const next = VARIANTS[(index + step + VARIANTS.length) % VARIANTS.length];
    const p = new URLSearchParams(params);
    p.set("variant", next.key);
    setParams(p, { replace: true });
  };

  useEffect(() => {
    const onKey = (e) => {
      const t = e.target;
      if (t?.closest?.("input, textarea, select, [contenteditable], [role='tablist'], [role='listbox'], [role='menu']")) return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!import.meta.env.DEV) return null;
  const v = VARIANTS[index];
  return createPortal(
    <div data-prototype-switcher className="pointer-events-none fixed inset-x-0 bottom-4 z-[10050] flex justify-center">
      <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-mauve-12 p-1 text-mauve-1 shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
        <Button size="icon-sm" variant="ghost" className="rounded-full text-mauve-1 hover:bg-mauve-11 hover:text-mauve-1" onClick={() => go(-1)} aria-label="Previous option">
          <ChevronLeft size={16} />
        </Button>
        <span className="min-w-[19rem] px-2 text-center text-[13px] font-semibold">
          <span className="mr-1.5 rounded bg-mauve-11 px-1.5 py-0.5 font-mono text-[11px]">{v.key === "now" ? "–" : v.key}</span>
          {v.name}
          <span className="ml-2 text-[11px] font-medium text-mauve-8">prototype · ← →</span>
        </span>
        <Button size="icon-sm" variant="ghost" className="rounded-full text-mauve-1 hover:bg-mauve-11 hover:text-mauve-1" onClick={() => go(1)} aria-label="Next option">
          <ChevronRight size={16} />
        </Button>
      </div>
    </div>,
    document.body,
  );
}
