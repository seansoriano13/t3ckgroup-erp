// PROTOTYPE (throwaway) — Option A, "Like IPAS".
// List: state pills with counts, one filter bar, the Purchasing table, the totals band, a pager.
// Report: the record window over the list (ModalShell "record"): Record header, pills, the headline
// figures, then every part as a block that opens in place. Hand edits happen inside the blocks.
import { useState } from "react";
import { Banknote, FilePlus2, Plus, RefreshCw, TriangleAlert } from "lucide-react";

import PageShell from "../../../../components/ui/PageShell";
import EmptyState from "../../../../components/ui/EmptyState";
import QueryError from "../../../../components/ui/QueryError";
import PageLoading from "../../../../components/ui/PageLoading";
import ModalShell from "../../../../components/ui/ModalShell";
import TabGroup from "../../../../components/ui/TabGroup";
import StatusBadge from "../../../../components/StatusBadge";
import { Button } from "../../../../components/ui/button";
import RecordHeader from "../../../../components/record/RecordHeader";
import PropertyPills from "../../../../components/record/PropertyPills";
import NumbersStrip from "../../../../components/record/NumbersStrip";
import RecordSections from "../../../../components/record/RecordSections";
import LinerList from "../../../../components/record/LinerList";
import RecordMoreMenu from "../../../../components/record/RecordMoreMenu";
import ExportButton from "../../../../components/purchasing/list/ExportButton";
import { listDate } from "../../../../utils/listDates";
import { COST_GROUP, COST_GROUPS } from "../../../../utils/opexReport";
import { HEALTH, STATE_WORDS, isGreyed, issuesOf, lineBadge, p0Groups, peso, pct, useListRows, usePrefetchReport, useReport } from "./data";
import {
  AddP0Dialog,
  EXPORT_HEADER,
  LeaveOutDialog,
  ListFilterBar,
  ListTable,
  NewButton,
  NewReportDialog,
  PriceForm,
  SummaryList,
  TypedCostDialog,
  TypedMark,
  exportRows,
  useListFilters,
} from "./parts";

const ALL = "all";

export function ListA({ onOpen, children }) {
  const { rows, isPending, isError, refetch } = useListRows();
  const f = useListFilters(rows);
  const prefetch = usePrefetchReport();
  const [state, setState] = useState(ALL);
  const [creating, setCreating] = useState(false);
  const count = (h) => f.scoped.filter((r) => r.health === h).length;
  const shown = state === ALL ? f.scoped : f.scoped.filter((r) => (state === "below" ? r.health === "below" || r.health === "loss" : r.health === state));

  return (
    <PageShell
      title="OPEX Report"
      description="What Odoo says each project really spent, one report per S0."
      action={<NewButton onClick={() => setCreating(true)} />}
      toolbar={
        <>
          <TabGroup
            variant="pill"
            size="sm"
            activeTab={state}
            onChange={setState}
            tabs={[
              { value: ALL, label: "All", badge: f.scoped.length },
              { value: "below", label: "Below go line", badge: count("below") + count("loss") },
              { value: "on_target", label: "On target", badge: count("on_target") },
            ]}
          />
          <ListFilterBar f={f} withHealthChip={false} actions={<ExportButton name="opex-reports" sheetName="OPEX" header={EXPORT_HEADER} rows={exportRows(shown)} />} />
        </>
      }
    >
      {isPending && <PageLoading label="OPEX Reports" />}
      {isError && <QueryError title="OPEX Reports could not be loaded." onRetry={refetch} />}
      {!isPending && !isError && shown.length === 0 && (
        <EmptyState
          icon={Banknote}
          title={rows.length === 0 ? "No OPEX Reports yet" : "No matching report"}
          description={rows.length === 0 ? "Start one from an S0 number." : "Nothing in this slice. Try another tab or clear the filters."}
        />
      )}
      {!isPending && !isError && shown.length > 0 && (
        <ListTable rows={shown} onOpen={onOpen} onHover={prefetch} search={f.search} />
      )}
      <NewReportDialog open={creating} onOpenChange={setCreating} rows={rows} onOpen={onOpen} />
      {children}
    </PageShell>
  );
}

const SECTIONS = [
  { title: "Costs", sections: [{ key: "p0", title: "P0 lines" }, { key: "expenses", title: "Expenses" }, { key: "typed", title: "Typed costs" }] },
  { title: "Figures", sections: [{ key: "summary", title: "Summary" }] },
];
const ALL_KEYS = SECTIONS.flatMap((g) => g.sections.map((s) => s.key));

export function RecordA({ s0, onClose }) {
  const r = useReport(s0);
  const { view, quick, read, readQuery, edits, actions, settings } = r;
  const [openKeys, setOpenKeys] = useState(() => new Set(["summary"]));
  const [addingP0, setAddingP0] = useState(false);
  const [cost, setCost] = useState(undefined); // undefined closed, null new, object editing
  const [leaving, setLeaving] = useState(null);

  const toggle = (k) =>
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const show = (k) => {
    setOpenKeys((prev) => new Set(prev).add(k));
    requestAnimationFrame(() => document.getElementById(`record-section-${k}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const health = quick ? (quick.revenue < 0 ? "loss" : quick.revenuePercent < Number(settings?.goLinePercent ?? 20) ? "below" : "on_target") : "unread";
  const issues = issuesOf(view);
  const groups = view ? p0Groups(view.lines) : [];
  const counted = view ? view.lines.filter((l) => l.countedPesos > 0).length : 0;
  const expensesShown = view ? view.expenses : [];
  const leftOutCount = expensesShown.filter((e) => e.leftOut).length;
  const groupSum = (key) =>
    expensesShown.filter((e) => !e.leftOut && (key === COST_GROUP.MARKETING ? e.group === COST_GROUP.MARKETING : e.group !== COST_GROUP.MARKETING)).reduce((a, e) => a + e.amount, 0);

  const line = read
    ? `Read from Odoo ${listDate(read.readAt)}, ${new Date(read.readAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}${readQuery.isFetching ? " · reading again…" : ""}`
    : readQuery.isError
      ? "Odoo could not be read."
      : quick?.savedAt
        ? `Reading Odoo… the figures below are from ${listDate(quick.savedAt)}`
        : "Reading Odoo…";

  const summaryOf = {
    p0: view ? `${groups.length} P0s, ${view.lines.length} lines, ${counted} counted · ${peso(view.lines.reduce((a, l) => a + l.countedPesos, 0))}` : "Reading Odoo…",
    expenses: view
      ? `Operation & Admin ${peso(groupSum(COST_GROUP.OPERATION_ADMIN))} · Marketing ${peso(groupSum(COST_GROUP.MARKETING))}${leftOutCount ? ` · ${leftOutCount} left out` : ""}`
      : "Reading Odoo…",
    typed: edits.typedCosts.length ? `${edits.typedCosts.length} · ${peso(edits.typedCosts.reduce((a, c) => a + Number(c.amount), 0))}` : "None. Add a cost Odoo does not have.",
    summary: quick ? `Revenue ${peso(quick.revenue)}, ${pct(quick.revenuePercent)} of the contract price` : "",
  };

  const bodyOf = (key) => {
    if (!view && key !== "summary" && key !== "typed") return <p className="text-[13px] text-muted-foreground">Reading Odoo…</p>;
    if (key === "p0")
      return (
        <div className="space-y-3">
          <LinerList
            label="P0 lines"
            empty="Odoo has no P0 line tagged to this S0, or named by a P0's Source Document."
            groups={groups.map((g) => {
              const hand = view.handP0s.find((h) => h.p0_number === g.p0);
              return {
                key: g.p0,
                title: (
                  <span className="flex w-full flex-wrap items-center gap-x-2">
                    <span className="font-mono font-semibold text-foreground">{g.p0}</span>
                    <span>{g.supplier}</span>
                    <span>· {STATE_WORDS[g.state] ?? g.state}</span>
                    {hand && (
                      <span className="ml-auto inline-flex items-center gap-1.5">
                        <TypedMark title="Added by hand" />
                        <Button type="button" size="xs" variant="ghost" onClick={() => actions.removeP0(hand.id)}>
                          Remove
                        </Button>
                      </span>
                    )}
                  </span>
                ),
                count: null,
                rows: g.lines.map((l) => ({
                  key: l.lineId,
                  main: <span className={isGreyed(l) ? "text-muted-foreground line-through decoration-mauve-8" : undefined}>{l.product}</span>,
                  label: l.product,
                  sub: `Qty ${l.quantity} · ${l.sharePercent}% to this S0 · ${peso(l.pesos)} on the P0`,
                  quantity: peso(l.countedPesos),
                  badge: lineBadge(l),
                  defaultOpen: false,
                  children: l.canType ? <PriceForm line={l} onSave={(n) => actions.setLinePrice(l.lineId, n)} onClear={() => actions.setLinePrice(l.lineId, null)} /> : undefined,
                })),
              };
            })}
            total={{ label: "Counted to this S0", value: peso(view.lines.reduce((a, l) => a + l.countedPesos, 0)) }}
          />
          {view.handP0s.filter((h) => h.missing).map((h) => (
            <p key={h.id} className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <span className="font-mono">{h.p0_number}</span> was added by hand but Odoo no longer has it. It does not count.
              <Button type="button" size="xs" variant="ghost" onClick={() => actions.removeP0(h.id)}>
                Remove
              </Button>
            </p>
          ))}
        </div>
      );
    if (key === "expenses")
      return (
        <LinerList
          label="Expenses"
          empty="Odoo has no petty-cash or bank expense tagged to this S0."
          groups={COST_GROUPS.filter((g) => g.key !== COST_GROUP.PRODUCT).map((g) => {
            const rows = expensesShown.filter((e) => (g.key === COST_GROUP.MARKETING ? e.group === COST_GROUP.MARKETING : e.group !== COST_GROUP.MARKETING));
            return {
              key: g.key,
              title: g.label,
              count: `${rows.length} · ${peso(groupSum(g.key))}`,
              rows: rows.map((e) => ({
                key: e.analyticLineId,
                main: <span className={e.leftOut ? "text-muted-foreground line-through decoration-mauve-8" : undefined}>{e.description}</span>,
                label: e.description,
                sub: `${e.date ? listDate(e.date) : "No date"} · ${e.account}${e.leftOut && e.leftOutNote ? ` · Left out: ${e.leftOutNote}` : ""}`,
                quantity: peso(e.amount),
                actions: e.leftOut ? (
                  <span className="flex items-center gap-1.5">
                    <StatusBadge label="Left out" theme="mauve" />
                    <Button type="button" size="xs" variant="outline" onClick={() => actions.setLeftOut(e.analyticLineId, false)}>
                      Put back
                    </Button>
                  </span>
                ) : (
                  <Button type="button" size="xs" variant="ghost" className="text-muted-foreground" onClick={() => setLeaving(e)}>
                    Leave out
                  </Button>
                ),
              })),
            };
          })}
        />
      );
    if (key === "typed")
      return (
        <LinerList
          label="Typed costs"
          empty="No Typed costs. Add one for a cost Odoo does not have, such as a fee paid in cash."
          rows={(view?.typedCosts ?? edits.typedCosts.map((c) => ({ ...c, amount: Number(c.amount), group: c.cost_group }))).map((c) => ({
            key: c.id,
            main: c.description,
            sub: `${c.cost_date ? listDate(c.cost_date) : "No date"} · counts as ${COST_GROUPS.find((g) => g.key === c.group)?.label}${c.note ? ` · ${c.note}` : ""}`,
            quantity: peso(c.amount),
            actions: (
              <Button type="button" size="xs" variant="outline" onClick={() => setCost(c)}>
                Edit
              </Button>
            ),
          }))}
        />
      );
    return <SummaryList quick={quick} edits={edits} read={read} settings={settings} actions={actions} />;
  };

  const footerOf = (key) => {
    if (key === "p0")
      return (
        <div className="mt-3 flex">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAddingP0(true)}>
            <Plus size={14} /> Add P0
          </Button>
        </div>
      );
    if (key === "typed")
      return (
        <div className="mt-3 flex">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setCost(null)}>
            <Plus size={14} /> Add Typed cost
          </Button>
        </div>
      );
    return null;
  };

  return (
    <>
      <ModalShell
        open
        onOpenChange={(n) => !n && onClose()}
        size="record"
        crumbs={["OPEX Report", s0]}
        headerActions={
          <span className="mr-1 flex items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" disabled={readQuery.isFetching} onClick={() => readQuery.refetch()}>
              <RefreshCw size={14} className={readQuery.isFetching ? "animate-spin" : ""} />
              Read again
            </Button>
            <RecordMoreMenu
              items={[
                { key: "p0", label: "Add P0", icon: Plus, onSelect: () => setAddingP0(true) },
                { key: "cost", label: "Add Typed cost", icon: FilePlus2, onSelect: () => setCost(null) },
              ]}
            />
          </span>
        }
      >
        <div className="space-y-6 pb-2">
          <div className="space-y-3">
            <RecordHeader reference={s0} name={view?.projectName ?? r.record?.snapshot?.project_name ?? undefined} badge={HEALTH[health]} line={line} />
            <PropertyPills
              items={[
                { key: "c", label: "Contract price", value: edits.contract_price != null ? "Typed" : "From Odoo" },
                { key: "r", label: "Retention", value: edits.retention != null ? "Typed" : "At the rate" },
                { key: "h", label: "Hand edits", value: String(edits.handP0s.length + edits.typedCosts.length + edits.linePrices.length + edits.leftOut.length) },
                ...(r.hasStubEdits ? [{ key: "p", label: "Prototype", value: "not saved" }] : []),
              ]}
            />
          </div>

          {readQuery.isError && (
            <div role="alert" className="rounded-xl border border-red-6 bg-red-a2 px-4 py-3 text-sm text-red-11">
              Odoo could not be read. The figures are the ones saved last time. <Button variant="link" size="xs" onClick={() => readQuery.refetch()}>Try again</Button>
            </div>
          )}
          {read?.noProjectTag && (
            <p className="flex items-start gap-2 rounded-xl bg-amber-a3 px-3 py-2 text-[13px] text-amber-12">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" /> Odoo has no Project tag for {s0}. Only P0s whose Source Document names it are shown.
            </p>
          )}

          {quick && (
            <NumbersStrip
              stats={[
                { key: "c", label: "Contract price", value: peso(quick.contractPrice), sub: edits.contract_price != null ? "Typed by Finance" : "From Odoo's S0", onOpen: () => show("summary") },
                {
                  key: "o",
                  label: "Actual OPEX",
                  value: peso(quick.actualOpex),
                  sub: `Product ${peso(quick.productCost)} · Expenses ${peso((quick.operationAdmin ?? 0) + (quick.marketing ?? 0))}`,
                  onOpen: () => show("p0"),
                },
                { key: "r", label: "Revenue", value: peso(quick.revenue), sub: `${pct(quick.revenuePercent)} of the contract price`, tone: health === "on_target" ? undefined : "warning", onOpen: () => show("summary") },
                {
                  key: "n",
                  label: "Needs a look",
                  value: view ? String(issues.length) : "…",
                  sub: view ? (issues.length ? `${issues.filter((i) => i.kind === "zero").length} zero-price lines, ${issues.filter((i) => i.kind === "notag").length} P0s with no tag` : "Nothing") : "Reading Odoo",
                  tone: issues.length ? "warning" : undefined,
                  onOpen: () => show("p0"),
                },
              ]}
            />
          )}

          <RecordSections
            groups={SECTIONS}
            openKeys={openKeys}
            onToggle={toggle}
            onOpenAll={() => setOpenKeys(new Set(ALL_KEYS))}
            onCloseAll={() => setOpenKeys(new Set())}
            stateOf={() => null}
            summaryOf={(k) => summaryOf[k]}
            bodyOf={bodyOf}
            footerOf={footerOf}
          />
        </div>
      </ModalShell>

      <AddP0Dialog open={addingP0} onOpenChange={setAddingP0} onAdd={actions.addP0} />
      <TypedCostDialog open={cost !== undefined} onOpenChange={(o) => !o && setCost(undefined)} cost={cost ?? null} onSave={actions.saveTypedCost} onDelete={actions.deleteTypedCost} />
      <LeaveOutDialog expense={leaving} onOpenChange={(o) => !o && setLeaving(null)} onConfirm={(e, note) => actions.setLeftOut(e.analyticLineId, true, note)} />
    </>
  );
}
