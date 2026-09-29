/**
 * SOR modal layout. The two charts picked in
 * round 3: where the money is (each product's share of the value) and time in
 * each stage (one bar per Stage visit, first entry → today).
 */
import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TONE_BG } from "./StageStrip";
import { formatPHP, formatShort, itemsTotal, showMoney } from "./shared";

const DAY = 86400000;

export function MoneyBars({ p, onOpen }) {
  const { items } = p.ctx;
  const money = showMoney(p);
  const rows = useMemo(
    () =>
      items
        .map((it) => ({ id: it.id, name: it.product_name, qty: it.quantity, total: (Number(it.quantity) || 0) * (Number(it.unit_price) || 0) }))
        .sort((a, b) => b.total - a.total),
    [items],
  );
  const sum = itemsTotal(items);
  const top = rows.slice(0, 6);
  const rest = rows.slice(6);
  const restSum = rest.reduce((s, r) => s + r.total, 0);

  if (p.ctx.itemsLoading) return <p className="text-sm text-muted-foreground">Loading products…</p>;
  if (!rows.length) {
    return (
      <p className="text-sm text-muted-foreground">
        {p.opportunity.sales_reference ? "No products pulled from Odoo yet." : "No products yet — they come from the Odoo quotation once there's a Sales Reference."}
      </p>
    );
  }

  return (
    <div>
      <ul className="space-y-2.5">
        {top.map((r) => {
          const pct = sum > 0 ? (r.total / sum) * 100 : 0;
          return (
            <li key={r.id}>
              <div className="flex items-baseline gap-3 text-[13px]">
                <span className="min-w-0 flex-1 truncate font-semibold text-foreground" title={r.name}>
                  {r.name}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">×{r.qty}</span>
                {money && <span className="w-28 shrink-0 text-right font-semibold tabular-nums text-foreground">{formatPHP(r.total)}</span>}
              </div>
              {money && (
                <div className="mt-1 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-mauve-3">
                    <div className="h-full rounded-full bg-mauve-10" style={{ width: `${Math.max(pct, 0.8)}%` }} />
                  </div>
                  <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">{pct < 1 ? "<1" : Math.round(pct)}%</span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex items-baseline justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
        <span>
          {rest.length ? `+ ${rest.length} more line${rest.length === 1 ? "" : "s"}${money ? ` · ${formatPHP(restSum)}` : ""}` : `${rows.length} line${rows.length === 1 ? "" : "s"}`}
        </span>
        <Button type="button" variant="ghost" size="xs" onClick={onOpen} className="gap-1 text-muted-foreground hover:text-foreground">
          All products <ArrowRight size={12} />
        </Button>
      </div>
    </div>
  );
}

export function StageTimeChart({ p, visits, onOpen }) {
  const rows = useMemo(() => [...visits].sort((a, b) => new Date(a.enteredAt) - new Date(b.enteredAt)), [visits]);
  if (!p.isFlowDeal) return <p className="text-sm text-muted-foreground">Pipeline deals don't record time per stage — each move is in the Notes.</p>;
  if (!rows.length) return <p className="text-sm text-muted-foreground">No Stage Visits recorded yet.</p>;

  const now = Date.now();
  const t0 = new Date(rows[0].enteredAt).getTime();
  const span = Math.max(now - t0, DAY);
  const pos = (t) => ((t - t0) / span) * 100;

  return (
    <div>
      <ol className="space-y-1.5">
        {rows.map((v) => {
          const start = new Date(v.enteredAt).getTime();
          const end = v.leftAt ? new Date(v.leftAt).getTime() : now;
          const isCurrent = !v.leftAt;
          const days = Math.max(0, Math.round((end - start) / DAY));
          return (
            <li key={v.id} className="grid grid-cols-[150px_1fr_64px] items-center gap-3">
              <span className={cn("truncate text-[13px]", isCurrent ? "font-black text-foreground" : "font-medium text-foreground")} title={v.stage.name}>
                {isCurrent ? p.currentFlowStage?.name || v.stage.name : v.stage.name}
              </span>
              <div className="relative h-5 rounded-md bg-mauve-2">
                <div
                  className={cn(
                    "absolute inset-y-1 rounded-sm",
                    v.isRestricted ? "bg-mauve-5" : isCurrent ? TONE_BG[p.currentFlowStageTone] || "bg-foreground" : "bg-mauve-8",
                  )}
                  style={{ left: `${pos(start)}%`, width: `${Math.max(pos(end) - pos(start), 0.8)}%` }}
                  title={`${formatShort(v.enteredAt)} → ${v.leftAt ? formatShort(v.leftAt) : "now"}`}
                />
              </div>
              <span className="text-right text-xs tabular-nums text-muted-foreground">
                {v.isRestricted ? "restricted" : `${days} day${days === 1 ? "" : "s"}`}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="mt-2 grid grid-cols-[150px_1fr_64px] gap-3 text-[11px] tabular-nums text-muted-foreground">
        <span />
        <div className="flex justify-between">
          <span>{formatShort(rows[0].enteredAt)}</span>
          <span>Today</span>
        </div>
        <span />
      </div>
      <div className="mt-3 flex justify-end">
        <Button type="button" variant="ghost" size="xs" onClick={onOpen} className="gap-1 text-muted-foreground hover:text-foreground">
          What happened in each stage <ArrowRight size={12} />
        </Button>
      </div>
    </div>
  );
}
