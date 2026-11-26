// PROTOTYPE (throwaway) — Option C, "Like the Purchasing Dashboard".
// List: a row of totals on top (each one narrows the list), the filter bar, the table.
// Report: a slide-over from the right, the way the Dashboard opens an SOR and the Approval Center opens
// a request. It reads top to bottom: the four figures, what needs a look (each fixed in place), where
// the money went, then the summary. J / K step to the next report. "Open full" opens option A's window.
import { useState } from "react";
import { Banknote, FilePlus2, Plus, RefreshCw } from "lucide-react";

import PageShell from "../../../../components/ui/PageShell";
import EmptyState from "../../../../components/ui/EmptyState";
import QueryError from "../../../../components/ui/QueryError";
import PageLoading from "../../../../components/ui/PageLoading";
import ReportFigure from "../../../../components/ui/ReportFigure";
import SlideOver, { SlideOverBody, SlideOverFooter } from "../../../../components/ui/SlideOver";
import StatusBadge from "../../../../components/StatusBadge";
import { Button } from "../../../../components/ui/button";
import LinerList from "../../../../components/record/LinerList";
import { DetailSection } from "../../../../components/ui/DetailParts";
import { listDate } from "../../../../utils/listDates";
import { COST_GROUP, COST_GROUPS } from "../../../../utils/opexReport";
import { HEALTH, issuesOf, isGreyed, lineBadge, p0Groups, peso, pct, sumOf, useListRows, usePrefetchReport, useReport } from "./data";
import { AddP0Dialog, LeaveOutDialog, ListFilterBar, ListTable, NewButton, NewReportDialog, PriceForm, SummaryList, TypedCostDialog, useListFilters } from "./parts";

export function ListC({ onOpen, openS0, children }) {
  const { rows, isPending, isError, refetch } = useListRows();
  const f = useListFilters(rows);
  const prefetch = usePrefetchReport();
  const [creating, setCreating] = useState(false);
  const shown = f.filtered;
  const below = f.scoped.filter((r) => r.health === "below" || r.health === "loss").length;
  const totalContract = sumOf(shown, "contract");
  const totalRevenue = sumOf(shown, "revenue");

  return (
    <PageShell
      title="OPEX Report"
      description="What Odoo says each project really spent, one report per S0."
      action={<NewButton onClick={() => setCreating(true)} />}
      toolbar={<ListFilterBar f={f} />}
    >
      {!isPending && !isError && rows.length > 0 && (
        <ReportFigure
          stats={[
            { label: "Reports", value: shown.length, onClick: f.hasActiveFilters ? f.clear : undefined },
            { label: "Contract price", value: peso(totalContract) },
            { label: "Actual OPEX", value: peso(sumOf(shown, "actualOpex")) },
            { label: "Revenue", value: peso(totalRevenue), sub: totalContract ? `${pct((totalRevenue / totalContract) * 100)} of the contract prices` : undefined },
            { label: "Below go line", value: below, tone: "attention", onClick: () => f.setHealth(f.health === "below" ? null : "below") },
          ]}
        />
      )}
      {isPending && <PageLoading label="OPEX Reports" />}
      {isError && <QueryError title="OPEX Reports could not be loaded." onRetry={refetch} />}
      {!isPending && !isError && shown.length === 0 && (
        <EmptyState icon={Banknote} title={rows.length === 0 ? "No OPEX Reports yet" : "No matching report"} description="Nothing matches. Try another search or clear the filters." />
      )}
      {!isPending && !isError && shown.length > 0 && <ListTable rows={shown} onOpen={onOpen} onHover={prefetch} totals={null} search={f.search} activeS0={openS0} />}
      <NewReportDialog open={creating} onOpenChange={setCreating} rows={rows} onOpen={onOpen} />
      {typeof children === "function" ? children(shown) : children}
    </PageShell>
  );
}

function Figures({ quick, health }) {
  const items = [
    ["Contract price", peso(quick?.contractPrice)],
    ["Actual OPEX", peso(quick?.actualOpex)],
    ["Revenue", peso(quick?.revenue)],
    ["Revenue %", pct(quick?.revenuePercent)],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
      {items.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className={`mt-0.5 font-mono text-lg font-semibold tracking-tight tabular-nums ${label.startsWith("Revenue") && health !== "on_target" ? "text-amber-11" : "text-foreground"}`}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ReportPanelBody({ s0 }) {
  const r = useReport(s0);
  const { view, quick, read, readQuery, edits, actions, settings } = r;
  const [addingP0, setAddingP0] = useState(false);
  const [cost, setCost] = useState(undefined);
  const [leaving, setLeaving] = useState(null);
  const health = quick ? (quick.revenue < 0 ? "loss" : quick.revenuePercent < Number(settings?.goLinePercent ?? 20) ? "below" : "on_target") : "unread";
  const issues = issuesOf(view);

  const issueRows = issues.map((i) => {
    if (i.kind === "zero")
      return {
        key: i.key,
        main: `${i.line.p0} · ${i.line.product}`,
        sub: `Odoo has it at zero. Qty ${i.line.quantity}, ${i.line.sharePercent}% to this S0.`,
        badge: { label: "Type a price", theme: "amber" },
        children: <PriceForm line={i.line} onSave={(n) => actions.setLinePrice(i.line.lineId, n)} onClear={() => actions.setLinePrice(i.line.lineId, null)} />,
      };
    if (i.kind === "notag")
      return {
        key: i.key,
        main: `${i.p0} has no Project tag`,
        sub: `It counts in full, because its Source Document names ${s0}. Tag it in Odoo if only part of it is this project's.`,
        subWrap: true,
        badge: { label: "Check in Odoo", theme: "mauve" },
      };
    return {
      key: i.key,
      main: `${i.hand.p0_number} is no longer in Odoo`,
      sub: "It was added by hand. It does not count.",
      actions: (
        <Button size="xs" variant="outline" onClick={() => actions.removeP0(i.hand.id)}>
          Remove
        </Button>
      ),
    };
  });

  const expenseGroup = (key) => (view?.expenses ?? []).filter((e) => (key === COST_GROUP.MARKETING ? e.group === COST_GROUP.MARKETING : e.group !== COST_GROUP.MARKETING));
  const money = [
    {
      key: "product",
      main: "Product cost",
      sub: view ? `${p0Groups(view.lines).length} P0s, ${view.lines.filter((l) => l.countedPesos > 0).length} of ${view.lines.length} lines counted` : "Reading Odoo…",
      quantity: peso(quick?.productCost),
      children: view && (
        <ul className="space-y-1.5">
          {view.lines.map((l) => {
            const b = lineBadge(l);
            return (
              <li key={l.lineId} className={`flex items-baseline gap-2 text-xs ${isGreyed(l) ? "text-muted-foreground line-through decoration-mauve-8" : ""}`}>
                <span className="font-mono text-muted-foreground">{l.p0}</span>
                <span className="min-w-0 flex-1 truncate" title={l.product}>
                  {l.product}
                </span>
                {b && <StatusBadge label={b.label} theme={b.theme} />}
                <span className="font-mono tabular-nums">{peso(l.countedPesos)}</span>
              </li>
            );
          })}
        </ul>
      ),
    },
    ...COST_GROUPS.filter((g) => g.key !== COST_GROUP.PRODUCT).map((g) => ({
      key: g.key,
      main: g.label,
      sub: view ? `${expenseGroup(g.key).length} ${expenseGroup(g.key).length === 1 ? "expense" : "expenses"}${expenseGroup(g.key).some((e) => e.leftOut) ? `, ${expenseGroup(g.key).filter((e) => e.leftOut).length} left out` : ""}` : "Reading Odoo…",
      quantity: peso(g.key === COST_GROUP.MARKETING ? quick?.marketing : quick?.operationAdmin),
      children: view && (
        <ul className="space-y-1.5">
          {expenseGroup(g.key).map((e) => (
            <li key={e.analyticLineId} className="flex items-center gap-2 text-xs">
              <span className="w-12 shrink-0 text-muted-foreground">{e.date ? listDate(e.date) : "—"}</span>
              <span className={`min-w-0 flex-1 truncate ${e.leftOut ? "text-muted-foreground line-through decoration-mauve-8" : ""}`} title={e.description}>
                {e.description}
              </span>
              <span className={`font-mono tabular-nums ${e.leftOut ? "text-muted-foreground line-through" : ""}`}>{peso(e.amount)}</span>
              <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => (e.leftOut ? actions.setLeftOut(e.analyticLineId, false) : setLeaving(e))}>
                {e.leftOut ? "Put back" : "Leave out"}
              </Button>
            </li>
          ))}
          {(view.typedCosts ?? []).filter((c) => c.group === g.key).map((c) => (
            <li key={c.id} className="flex items-center gap-2 text-xs">
              <span className="w-12 shrink-0 text-muted-foreground">Typed</span>
              <span className="min-w-0 flex-1 truncate">{c.description}</span>
              <span className="font-mono tabular-nums">{peso(c.amount)}</span>
              <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => setCost(c)}>
                Edit
              </Button>
            </li>
          ))}
        </ul>
      ),
    })),
  ];

  return (
    <>
      <SlideOverBody>
        {readQuery.isError && (
          <p role="alert" className="rounded-xl border border-red-6 bg-red-a2 px-3 py-2 text-[13px] text-red-11">
            Odoo could not be read. The figures are the ones saved last time.
          </p>
        )}
        <Figures quick={quick} health={health} />
        <DetailSection title={`Needs a look${view ? ` · ${issues.length}` : ""}`}>
          {!view ? (
            <p className="text-[13px] text-muted-foreground">Reading Odoo…</p>
          ) : (
            <LinerList rows={issueRows} empty="Nothing needs a look. Every line has a price and a tag." />
          )}
        </DetailSection>
        <DetailSection title="Where the money went">
          <LinerList rows={money} total={{ label: "Actual OPEX, with retention", value: peso(quick?.actualOpex) }} />
        </DetailSection>
        <DetailSection title="Summary">
          <SummaryList quick={quick} edits={edits} read={read} settings={settings} actions={actions} compact />
        </DetailSection>
      </SlideOverBody>
      <SlideOverFooter>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAddingP0(true)}>
            <Plus size={14} /> Add P0
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setCost(null)}>
            <FilePlus2 size={14} /> Add Typed cost
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto gap-1.5 text-muted-foreground" disabled={readQuery.isFetching} onClick={() => readQuery.refetch()}>
            <RefreshCw size={14} className={readQuery.isFetching ? "animate-spin" : ""} />
            Read again
          </Button>
        </div>
        {r.hasStubEdits && <p className="text-xs text-muted-foreground">Prototype: your changes are not saved.</p>}
      </SlideOverFooter>
      <AddP0Dialog open={addingP0} onOpenChange={setAddingP0} onAdd={actions.addP0} />
      <TypedCostDialog open={cost !== undefined} onOpenChange={(o) => !o && setCost(undefined)} cost={cost ?? null} onSave={actions.saveTypedCost} onDelete={actions.deleteTypedCost} />
      <LeaveOutDialog expense={leaving} onOpenChange={(o) => !o && setLeaving(null)} onConfirm={(e, note) => actions.setLeftOut(e.analyticLineId, true, note)} />
    </>
  );
}

export function PanelC({ s0, rows, onOpen, onClose, onOpenFull }) {
  const index = rows.findIndex((r) => r.s0 === s0);
  const row = rows[index] ?? rows.find((r) => r.s0 === s0) ?? (s0 ? { s0, project: null, health: "unread", readAt: null } : null);
  return (
    <SlideOver
      record={s0 ? row : null}
      icon={Banknote}
      crumb="OPEX Report"
      identity={(rec) => ({
        ref: rec.s0,
        title: rec.project ?? "No Project tag in Odoo",
        badge: <StatusBadge label={HEALTH[rec.health].label} theme={HEALTH[rec.health].theme} />,
        subtitle: rec.readAt ? `Last read ${listDate(rec.readAt)}` : "Not read yet",
      })}
      index={Math.max(0, index)}
      total={index < 0 ? 1 : rows.length}
      onStep={(step) => onOpen(rows[index + step].s0)}
      onClose={onClose}
      onOpenFull={() => onOpenFull(s0)}
    >
      {(rec) => <ReportPanelBody key={rec.s0} s0={rec.s0} />}
    </SlideOver>
  );
}
