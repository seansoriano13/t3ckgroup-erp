/**
 * REMOVE-BEFORE-PROD — SOR modal layout prototype (ADR 0028). Build-gated:
 * SorModal loads this folder through a dynamic import() behind a static
 * VITE_APP_ENV check, so a production bundle has none of it. Delete the folder
 * by 2026-12-31 (CI fails staging after that) or bump the date on purpose.
 *
 * The layout switcher: a bar at the bottom of the SOR modal, so it only
 * exists while a modal is open. The pick is remembered per browser
 * (localStorage), so every SOR opened afterwards uses it; `?variant=X` in the
 * URL overrides and saves it. Defaults to the shipped layout (H).
 *
 * ← / → already step between SORs, so the layout keys are Shift + ← / →.
 */
import { useEffect, useState } from "react";
import { Check, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import Dropdown from "../../../ui/Dropdown";

export const VARIANTS = [
  { key: "B", name: "Overview board", blurb: "Every area as a panel; open one to work in it" },
  { key: "C", name: "Flow rail", blurb: "Stages top-to-bottom with Move buttons; tabs and notes as today" },
  { key: "D", name: "Rail + summary", blurb: "Stage rail, a one-glance summary, notes pop-out" },
  { key: "E", name: "Rail + board", blurb: "Stage rail beside the overview board, notes pop-out" },
  { key: "F", name: "Thread", blurb: "Notes and stage history as one timeline; work inline, status on the side" },
  { key: "G", name: "Summary · stacked", blurb: "Original ribbon; summary + money + time per stage in one column; sections behind a crumb" },
  { key: "H", name: "Summary · two columns (shipped)", blurb: "The layout production ships: one screen, crumb lists every section" },
  { key: "I", name: "Summary · report", blurb: "Same picks as one printed-looking page; crumb lists every section" },
];

// v2: the letters were reshuffled; an old saved letter would now mean a different layout.
export const DEFAULT_VARIANT = "H";
const STORAGE_KEY = "sor-modal-layout-v2";
const EVENT = "sor-modal-layout-change";

const isKey = (v) => VARIANTS.some((x) => x.key === v);

function save(key) {
  try {
    localStorage.setItem(STORAGE_KEY, key);
  } catch {
    // Private window or blocked storage: the pick lasts for this page only.
  }
}

function readVariant() {
  if (typeof window === "undefined") return DEFAULT_VARIANT;
  const fromUrl = new URLSearchParams(window.location.search).get("variant")?.toUpperCase();
  if (isKey(fromUrl)) {
    save(fromUrl);
    return fromUrl;
  }
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isKey(stored)) return stored;
  } catch {
    // fall through to the default
  }
  return DEFAULT_VARIANT;
}

export function usePrototypeVariant() {
  const [variant, setState] = useState(readVariant);
  useEffect(() => {
    const sync = (e) => setState(e?.detail && isKey(e.detail) ? e.detail : readVariant());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  const setVariant = (key) => {
    save(key);
    // Drop a stale ?variant= so it can't override the new pick on the next open.
    const url = new URL(window.location.href);
    if (url.searchParams.has("variant")) {
      url.searchParams.delete("variant");
      window.history.replaceState(window.history.state, "", url);
    }
    window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
  };
  return [variant, setVariant];
}

export default function PrototypeSwitcher({ variant, setVariant }) {
  const index = Math.max(0, VARIANTS.findIndex((v) => v.key === variant));
  const step = (dir) => setVariant(VARIANTS[(index + dir + VARIANTS.length) % VARIANTS.length].key);

  useEffect(() => {
    const onKey = (e) => {
      if (!e.shiftKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
      const el = document.activeElement;
      if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.isContentEditable) return;
      e.preventDefault();
      step(e.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const current = VARIANTS[index];

  return (
    <div className="flex shrink-0 items-center justify-center gap-1 bg-mauve-12 px-3 py-1.5 text-mauve-1">
      <span className="mr-2 hidden text-[9px] font-black tracking-[0.2em] text-mauve-8 uppercase sm:inline">Layout preview</span>
      <Button type="button" variant="ghost" size="icon-xs" onClick={() => step(-1)} aria-label="Previous layout" className="text-mauve-1 hover:bg-mauve-11 hover:text-mauve-1">
        <ChevronLeft size={14} />
      </Button>
      <Dropdown
        usePortal
        placement="top"
        popoverClassName="popover-enter z-[10001] max-h-[70vh] w-80 overflow-y-auto rounded-xl bg-popover p-1.5 shadow-2xl ring-1 ring-mauve-6"
        trigger={
          <Button type="button" variant="ghost" size="xs" className="min-w-[170px] gap-1.5 font-bold text-mauve-1 hover:bg-mauve-11 hover:text-mauve-1">
            {current.key} · {current.name}
            <ChevronUp size={12} className="text-mauve-8" />
          </Button>
        }
      >
        {({ close }) => (
          <div className="flex flex-col gap-0.5">
            {VARIANTS.map((v) => (
              <Button
                key={v.key}
                type="button"
                variant="ghost"
                onClick={() => {
                  close();
                  setVariant(v.key);
                }}
                className={cn("h-auto items-start justify-start gap-2.5 rounded-lg px-2.5 py-2 text-left", v.key === variant && "bg-muted")}
              >
                <span className="w-4 shrink-0 pt-0.5 font-mono text-xs font-bold text-muted-foreground">{v.key}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-foreground">{v.name}</span>
                  <span className="block text-[11px] font-normal whitespace-normal text-muted-foreground">{v.blurb}</span>
                </span>
                {v.key === variant && <Check size={14} className="mt-0.5 shrink-0 text-foreground" />}
              </Button>
            ))}
          </div>
        )}
      </Dropdown>
      <Button type="button" variant="ghost" size="icon-xs" onClick={() => step(1)} aria-label="Next layout" className="text-mauve-1 hover:bg-mauve-11 hover:text-mauve-1">
        <ChevronRight size={14} />
      </Button>
      <span className="ml-2 hidden text-[10px] text-mauve-8 md:inline">Shift + ← / →</span>
    </div>
  );
}
