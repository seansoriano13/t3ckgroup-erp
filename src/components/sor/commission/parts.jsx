import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "../../ui/button";
import { SelectField } from "../../ui/SelectField";
import { DATE_PRESETS, SPLIT_PROJECT_TYPES, TONE } from "./commissionView";

/** A small colour key. `tone` is a TONE key; `color` is any CSS colour. */
export function Swatch({ tone, color, className }) {
  return <span aria-hidden className={cn("inline-block h-2 w-2 shrink-0 rounded-full", className)} style={{ background: color ?? TONE[tone]?.solid }} />;
}

/** Two-way switch (e.g. Realized / Projected). */
export function Segmented({ options, value, onChange, label }) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg bg-muted p-0.5">
      {options.map((o) => (
        <Button
          key={o.value}
          type="button"
          variant="ghost"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("h-7 rounded-md px-3 text-xs font-semibold", value === o.value ? "bg-card text-foreground shadow-xs hover:bg-card" : "text-muted-foreground")}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}

export function PeriodField({ value, onChange }) {
  return <SelectField aria-label="Period" value={value} onChange={onChange} options={DATE_PRESETS} className="data-[size=default]:h-8 min-w-[150px] text-xs font-semibold" />;
}

export function ProjectTypeSwitch({ value, onChange }) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1" role="radiogroup" aria-label="Project Type">
      {SPLIT_PROJECT_TYPES.map((p) => (
        <Button
          key={p.value}
          type="button"
          role="radio"
          variant="ghost"
          aria-checked={value === p.value}
          onClick={() => onChange(p.value)}
          className={cn("h-8 rounded-lg text-xs font-medium", value === p.value ? "bg-card text-foreground shadow-xs hover:bg-card" : "text-muted-foreground")}
        >
          {p.label}
        </Button>
      ))}
    </div>
  );
}

export function Pager({ page, pageSize, total, onPage }) {
  if (total === 0) return null;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  // First, last, and the pages either side of the current one.
  const nums = [...new Set([0, pages - 1, page - 1, page, page + 1])].filter((n) => n >= 0 && n < pages).sort((a, b) => a - b);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-sm">
      <span className="tabular-nums text-muted-foreground">
        Showing <span className="font-medium text-foreground">{from}–{to}</span> of <span className="font-medium text-foreground">{total}</span>
      </span>
      {pages > 1 && (
        <div className="flex items-center gap-1">
          <Button type="button" variant="outline" size="icon-sm" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft /></Button>
          {nums.map((n, i) => (
            <span key={n} className="flex items-center gap-1">
              {i > 0 && n - nums[i - 1] > 1 && <span className="px-1 text-muted-foreground">…</span>}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-current={n === page ? "page" : undefined}
                onClick={() => onPage(n)}
                className={cn("tabular-nums", n === page ? "bg-foreground text-background hover:bg-foreground hover:text-background" : "text-muted-foreground")}
              >
                {n + 1}
              </Button>
            </span>
          ))}
          <Button type="button" variant="outline" size="icon-sm" disabled={page >= pages - 1} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight /></Button>
        </div>
      )}
    </div>
  );
}

export function Meter({ value, max = 100, color = "var(--mauve-12)" }) {
  const width = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
      <span className="block h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: `${Math.max(width, value > 0 ? 1.5 : 0)}%`, background: color }} />
    </span>
  );
}

/** A thin bar split into coloured parts: `[{ key, percent, color }]`. */
export function SplitBar({ parts, className }) {
  return (
    <span className={cn("flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted", className)} aria-hidden>
      {parts.map((p) => <span key={p.key} className="h-full transition-[width] duration-300" style={{ width: `${p.percent}%`, background: p.color }} />)}
    </span>
  );
}

/** A titled, bordered list of UsageRows. */
export function UsageSection({ title, description, children }) {
  return (
    <section className="min-w-0">
      <div className="mb-3">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">{children}</div>
    </section>
  );
}

/** Label · meter · number. With `detail` it expands in place behind a chevron. */
export function UsageRow({ lead, label, sub, meter, value, valueSub, detail, open, onToggle }) {
  const body = (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-3">
        {detail && <ChevronRight size={14} className={cn("shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-90")} />}
        {lead}
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-foreground">{label}</span>
          {sub && <span className="block truncate text-xs font-normal text-muted-foreground">{sub}</span>}
        </span>
      </span>
      <span className="hidden w-32 shrink-0 sm:block">{meter}</span>
      <span className="w-24 shrink-0 text-right">
        <span className="block text-sm font-medium tabular-nums text-foreground">{value}</span>
        {valueSub && <span className="block text-xs font-normal tabular-nums text-muted-foreground">{valueSub}</span>}
      </span>
    </>
  );
  return (
    <div>
      {detail ? (
        <Button type="button" variant="ghost" aria-expanded={open} onClick={onToggle} className="h-auto w-full justify-between gap-5 rounded-none px-4 py-3 text-left hover:bg-muted/50">
          {body}
        </Button>
      ) : (
        <div className="flex items-center justify-between gap-5 px-4 py-3">{body}</div>
      )}
      {detail && open && <div className="border-t border-border bg-muted/30 px-4 py-3 pl-11">{detail}</div>}
    </div>
  );
}
