import { useState } from "react";
import { FilePlus2, Plus, RefreshCw, TriangleAlert } from "lucide-react";

import ModalShell from "@/components/ui/ModalShell";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import RecordNotFound from "@/components/ui/RecordNotFound";
import PageLoading from "@/components/ui/PageLoading";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import RecordHeader from "@/components/record/RecordHeader";
import PropertyPills from "@/components/record/PropertyPills";
import NumbersStrip from "@/components/record/NumbersStrip";
import RecordSections from "@/components/record/RecordSections";
import LinerList from "@/components/record/LinerList";
import RecordMoreMenu from "@/components/record/RecordMoreMenu";
import { sectionDomId } from "@/components/record/sectionDom";
import { listDate } from "@/utils/listDates";
import { COST_GROUP, COST_GROUPS, formatPesos } from "@/utils/opexReport";
import { OPEX_HEALTH_LOOK, P0_STATE_WORDS, isGreyedLine, lineBadge, opexHealth, opexIssues, p0Groups } from "@/utils/opexList";
import OpexSummary, { TypedMark } from "./OpexSummary";
import { AddP0Dialog, LeaveOutDialog, PriceForm, TypedCostDialog } from "./OpexDialogs";
import { useOpexReport } from "./useOpexReport";

/**
 * One OPEX Report in the record window over the OPEX list (spec #1241, redesign 2026-11-26),
 * built like an IPAS: the Record header, pills, the four headline figures, then each part as
 * a block that opens in place, several at once. Finance's hand edits happen in the blocks
 * (a missing price under its line, Leave out on an expense) or in a small window (Add P0,
 * Add Typed cost). Every hand edit is marked typed.
 */

const SECTIONS = [
  { key: "p0", title: "P0 lines" },
  { key: "expenses", title: "Expenses" },
  { key: "typed", title: "Typed costs" },
];
const time = (iso) => new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
const sumPesos = (amounts) => amounts.reduce((total, n) => total + Math.round(Number(n) * 100), 0) / 100;
const isMarketing = (e) => e.group === COST_GROUP.MARKETING;
const expenseGroupOf = (key) => (key === COST_GROUP.MARKETING ? isMarketing : (e) => !isMarketing(e));

export default function OpexReportWindow({ s0, onClose }) {
  const { report, saved, edits, reportQuery, readQuery, read, view, quick, settings, actions } = useOpexReport(s0);
  const [openKeys, setOpenKeys] = useState(() => new Set(["summary"]));
  const [addingP0, setAddingP0] = useState(false);
  const [cost, setCost] = useState(undefined); // undefined: closed; null: new; a cost: editing
  const [deletingCost, setDeletingCost] = useState(null);
  const [removingP0, setRemovingP0] = useState(null);
  const [leaving, setLeaving] = useState(null);

  const issues = opexIssues(view);
  // The part that needs Finance opens when Odoo's answer first arrives, once.
  const [arrived, setArrived] = useState(false);
  if (view && !arrived) {
    setArrived(true);
    const needs = [];
    if (issues.zeroPrice.length || issues.noTag.length) needs.push("p0");
    if (issues.missingP0s.length || issues.orphans) needs.push("gone");
    if (needs.length) setOpenKeys((prev) => new Set([...prev, ...needs]));
  }

  const toggle = (key) =>
    setOpenKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const show = (key) => {
    setOpenKeys((prev) => new Set(prev).add(key));
    requestAnimationFrame(() => document.getElementById(sectionDomId(key))?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const crumbs = ["OPEX Report", s0];
  if (reportQuery.isPending) {
    return (
      <ModalShell open onOpenChange={(next) => !next && onClose()} size="record" crumbs={crumbs}>
        <PageLoading label="OPEX Report" />
      </ModalShell>
    );
  }
  if (reportQuery.isError || !report) {
    return (
      <ModalShell open onOpenChange={(next) => !next && onClose()} size="record" crumbs={crumbs}>
        <RecordNotFound recordType="OPEX Report" onBack={onClose} backLabel="Back to the list" />
      </ModalShell>
    );
  }

  const goLine = Number(settings?.goLinePercent ?? 20);
  const health = opexHealth(quick?.revenue ?? null, quick?.revenuePercent ?? null, goLine);
  const groups = view ? p0Groups(view.lines) : [];
  const expenses = view?.expenses ?? [];
  const counted = view ? sumPesos(view.lines.map((l) => l.countedPesos)) : 0;
  const groupTotal = (key) => sumPesos(expenses.filter((e) => !e.leftOut && expenseGroupOf(key)(e)).map((e) => e.amount));
  const leftOutCount = expenses.filter((e) => e.leftOut).length;
  const typedCosts = view?.typedCosts ?? edits.typedCosts.map((c) => ({ ...c, amount: Number(c.amount), group: c.cost_group }));
  const handEdits = edits.handP0s.length + edits.typedCosts.length + edits.linePrices.length + edits.leftOut.length;
  const projectName = view?.projectName ?? saved?.project_name ?? undefined;
  const gone = view ? issues.missingP0s.length + issues.orphans : 0;

  const line = read
    ? `Read from Odoo ${listDate(read.readAt)}, ${time(read.readAt)}${readQuery.isFetching ? " · reading again…" : ""}`
    : readQuery.isError
      ? quick?.savedAt
        ? `Odoo could not be read. The figures are the ones saved ${listDate(quick.savedAt)}.`
        : "Odoo could not be read."
      : quick?.savedAt
        ? `Reading Odoo… the figures are the ones saved ${listDate(quick.savedAt)}.`
        : "Reading Odoo…";

  const reading = <p className="text-[13px] text-muted-foreground">{readQuery.isError ? "Odoo could not be read." : "Reading Odoo…"}</p>;

  const sections = [{ title: "Costs", sections: [...SECTIONS, ...(gone ? [{ key: "gone", title: "No longer in Odoo" }] : [])] }, { title: "Figures", sections: [{ key: "summary", title: "Summary" }] }];

  const summaryOf = {
    p0: view
      ? `${groups.length} P0s, ${view.lines.length} lines, ${view.lines.filter((l) => l.countedPesos > 0).length} counted · ${formatPesos(counted)}${issues.zeroPrice.length ? ` · ${issues.zeroPrice.length} with no price` : ""}`
      : readQuery.isError
        ? "Odoo could not be read."
        : "Reading Odoo…",
    expenses: view
      ? `Operation & Admin ${formatPesos(groupTotal(COST_GROUP.OPERATION_ADMIN))} · Marketing ${formatPesos(groupTotal(COST_GROUP.MARKETING))}${leftOutCount ? ` · ${leftOutCount} left out` : ""}`
      : readQuery.isError
        ? "Odoo could not be read."
        : "Reading Odoo…",
    typed: typedCosts.length ? `${typedCosts.length} · ${formatPesos(sumPesos(typedCosts.map((c) => c.amount)))}` : "None. Add a cost Odoo does not have.",
    gone: `${gone} hand ${gone === 1 ? "edit points" : "edits point"} at something Odoo no longer has. ${gone === 1 ? "It does" : "They do"} not count.`,
    summary: quick ? `Revenue ${formatPesos(quick.revenue)}, ${quick.revenuePercent == null ? "—" : `${Number(quick.revenuePercent).toFixed(2)}%`} of the contract price` : "",
  };

  const p0Body = () => (
    <LinerList
      label="P0 lines"
      empty="Odoo has no P0 line tagged to this S0, or named by a P0's Source Document."
      groups={groups.map((g) => {
        const hand = view.handP0s.find((h) => h.p0_number === g.p0);
        return {
          key: g.p0,
          label: `${g.p0} ${g.supplier}`,
          title: (
            <span className="flex w-full flex-wrap items-center gap-x-2">
              <span className="font-mono font-semibold text-foreground">{g.p0}</span>
              <span>{g.supplier}</span>
              <span>· {P0_STATE_WORDS[g.state] ?? g.state}</span>
              {hand && (
                <span className="ml-auto inline-flex items-center gap-1">
                  <TypedMark title="Added by hand" />
                  <Button type="button" size="xs" variant="ghost" aria-label={`Remove ${g.p0}`} onClick={() => setRemovingP0(hand)}>
                    Remove
                  </Button>
                </span>
              )}
            </span>
          ),
          rows: g.lines.map((l) => ({
            key: l.lineId,
            label: `${l.p0} ${l.product}`,
            testId: isGreyedLine(l) ? "opex-line-greyed" : "opex-line",
            main: <span className={isGreyedLine(l) ? "text-muted-foreground line-through decoration-mauve-8" : undefined}>{l.product}</span>,
            sub: `Qty ${l.quantity} · ${l.sharePercent}% to this S0 · ${formatPesos(l.pesos)} on the P0`,
            quantity: formatPesos(l.countedPesos),
            badge: lineBadge(l),
            children: l.canType ? (
              <PriceForm key={`${l.lineId}-${l.typedPrice ?? ""}`} line={l} onSave={(n) => actions.setLinePrice(l.lineId, n)} onClear={() => actions.setLinePrice(l.lineId, null)} />
            ) : undefined,
          })),
        };
      })}
      total={{ label: "Counted to this S0", value: formatPesos(counted) }}
    />
  );

  const expensesBody = () => (
    <LinerList
      label="Expenses"
      empty="Odoo has no petty-cash or bank expense tagged to this S0."
      groups={COST_GROUPS.filter((g) => g.key !== COST_GROUP.PRODUCT).map((g) => {
        const rows = expenses.filter(expenseGroupOf(g.key));
        return {
          key: g.key,
          title: g.label,
          count: `${rows.length} · ${formatPesos(groupTotal(g.key))}`,
          rows: rows.map((e) => ({
            key: e.analyticLineId,
            label: e.description,
            testId: e.leftOut ? "opex-expense-left-out" : "opex-expense",
            main: <span className={e.leftOut ? "text-muted-foreground line-through decoration-mauve-8" : undefined}>{e.description}</span>,
            sub: `${e.date ? listDate(e.date) : "No date"} · ${e.account}${e.leftOut && e.leftOutNote ? ` · Left out: ${e.leftOutNote}` : ""}`,
            subWrap: true,
            quantity: formatPesos(e.amount),
            actions: e.leftOut ? (
              <span className="flex shrink-0 items-center gap-1.5">
                <StatusBadge label="Left out" theme="mauve" />
                <Button type="button" size="xs" variant="outline" aria-label={`Put back ${e.description}`} onClick={() => actions.setLeftOut(e.analyticLineId, false)}>
                  Put back
                </Button>
              </span>
            ) : (
              <Button type="button" size="xs" variant="ghost" className="shrink-0 text-muted-foreground" aria-label={`Leave out ${e.description}`} onClick={() => setLeaving(e)}>
                Leave out
              </Button>
            ),
          })),
        };
      })}
    />
  );

  const typedBody = () => (
    <LinerList
      label="Typed costs"
      empty="No Typed costs. Add one for a cost Odoo does not have, such as a fee paid in cash."
      rows={typedCosts.map((c) => ({
        key: c.id,
        main: (
          <>
            {c.description}
            <TypedMark />
          </>
        ),
        label: c.description,
        sub: `${c.cost_date ? listDate(c.cost_date) : "No date"} · counts as ${COST_GROUPS.find((g) => g.key === c.group)?.label ?? c.group}${c.note ? ` · ${c.note}` : ""}`,
        quantity: formatPesos(c.amount),
        actions: (
          <Button type="button" size="xs" variant="outline" className="shrink-0" aria-label={`Edit ${c.description}`} onClick={() => setCost(c)}>
            Edit
          </Button>
        ),
      }))}
    />
  );

  const goneBody = () => (
    <LinerList
      label="No longer in Odoo"
      rows={[
        ...issues.missingP0s.map((h) => ({
          key: `p0-${h.id}`,
          main: <span className="font-mono">{h.p0_number}</span>,
          label: h.p0_number,
          sub: "Added by hand, but Odoo no longer has this P0. It does not count.",
          subWrap: true,
          actions: (
            <Button type="button" size="xs" variant="outline" className="shrink-0" aria-label={`Remove ${h.p0_number}`} onClick={() => setRemovingP0(h)}>
              Remove
            </Button>
          ),
        })),
        ...view.orphans.linePrices.map((p) => ({
          key: `price-${p.id}`,
          main: `Typed price ${formatPesos(p.unit_price)}`,
          label: `typed price for line ${p.odoo_line_id}`,
          sub: "Odoo no longer has this P0 line. It does not count.",
          actions: (
            <Button type="button" size="xs" variant="outline" className="shrink-0" onClick={() => actions.setLinePrice(Number(p.odoo_line_id), null)}>
              Remove
            </Button>
          ),
        })),
        ...view.orphans.leftOut.map((l) => ({
          key: `left-${l.id}`,
          main: "Left-out expense",
          label: `left-out expense ${l.analytic_line_id}`,
          sub: "Odoo no longer has this expense. It does not count.",
          actions: (
            <Button type="button" size="xs" variant="outline" className="shrink-0" onClick={() => actions.setLeftOut(Number(l.analytic_line_id), false)}>
              Remove
            </Button>
          ),
        })),
      ]}
    />
  );

  const bodyOf = (key) => {
    if (key === "summary") return <OpexSummary quick={quick} report={report} read={read} settings={settings} onField={actions.setField} />;
    if (key === "typed") return typedBody();
    if (!view) return reading;
    if (key === "p0") return p0Body();
    if (key === "expenses") return expensesBody();
    return goneBody();
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

  const needsLook = issues.zeroPrice.length + issues.noTag.length + gone;
  const allKeys = sections.flatMap((g) => g.sections.map((s) => s.key));

  return (
    <>
      <ModalShell
        open
        onOpenChange={(next) => !next && onClose()}
        size="record"
        crumbs={crumbs}
        headerActions={
          <span className="mr-1 flex items-center gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" disabled={readQuery.isFetching} onClick={actions.readAgain}>
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
            <RecordHeader reference={s0} name={projectName} badge={OPEX_HEALTH_LOOK[health]} line={line} />
            <PropertyPills
              items={[
                { key: "contract", label: "Contract price", value: report.contract_price != null ? "Typed" : "From Odoo" },
                { key: "retention", label: "Retention", value: report.retention != null ? "Typed" : "At the rate" },
                { key: "edits", label: "Hand edits", value: String(handEdits) },
              ]}
            />
          </div>

          {readQuery.isError && (
            <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-red-6 bg-red-a2 px-4 py-3 text-sm text-red-11">
              <span>
                Odoo could not be read, so the lines are not shown.
                {quick?.fromSnapshot ? " The figures are the ones saved last time." : ""} {readQuery.error?.message}
              </span>
              <Button variant="outline" size="xs" onClick={actions.readAgain}>
                Try again
              </Button>
            </div>
          )}
          {read?.noProjectTag && (
            <p role="alert" className="flex items-start gap-2 rounded-xl bg-amber-a3 px-3 py-2 text-[13px] text-amber-12">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              Odoo has no Project tag for {s0}. This report shows only P0s whose Source Document names it.
            </p>
          )}

          {quick && (
            <NumbersStrip
              stats={[
                {
                  key: "contract",
                  label: "Contract price",
                  value: formatPesos(quick.contractPrice),
                  sub: report.contract_price != null ? "Typed by Finance" : "From Odoo's S0",
                  onOpen: () => show("summary"),
                },
                {
                  key: "opex",
                  label: "Actual OPEX",
                  value: formatPesos(quick.actualOpex),
                  sub: `Product ${formatPesos(quick.productCost)} · Expenses ${formatPesos(sumPesos([quick.operationAdmin ?? 0, quick.marketing ?? 0]))}`,
                  onOpen: () => show("p0"),
                },
                {
                  key: "revenue",
                  label: "Revenue",
                  value: formatPesos(quick.revenue),
                  sub: `${quick.revenuePercent == null ? "—" : `${Number(quick.revenuePercent).toFixed(2)}%`} of the contract price`,
                  tone: health === "on_target" ? undefined : "warning",
                  onOpen: () => show("summary"),
                },
                {
                  key: "look",
                  label: "Needs a look",
                  value: view ? String(needsLook) : "…",
                  sub: view
                    ? needsLook
                      ? [
                          issues.zeroPrice.length && `${issues.zeroPrice.length} with no price`,
                          issues.noTag.length && `${issues.noTag.length} P0s with no tag`,
                          gone && `${gone} no longer in Odoo`,
                        ]
                          .filter(Boolean)
                          .join(", ")
                      : "Nothing"
                    : "Reading Odoo",
                  tone: needsLook ? "warning" : undefined,
                  onOpen: () => show(gone && !issues.zeroPrice.length && !issues.noTag.length ? "gone" : "p0"),
                },
              ]}
            />
          )}

          <RecordSections
            groups={sections}
            openKeys={openKeys}
            onToggle={toggle}
            onOpenAll={() => setOpenKeys(new Set(allKeys))}
            onCloseAll={() => setOpenKeys(new Set())}
            stateOf={() => null}
            summaryOf={(key) => summaryOf[key]}
            bodyOf={bodyOf}
            footerOf={footerOf}
          />
        </div>
      </ModalShell>

      <AddP0Dialog open={addingP0} onOpenChange={setAddingP0} onAdd={actions.addP0} />
      <TypedCostDialog
        open={cost !== undefined}
        onOpenChange={(next) => !next && setCost(undefined)}
        cost={cost ?? null}
        onSave={actions.saveTypedCost}
        onDelete={(c) => setDeletingCost(c)}
      />
      <ConfirmDialog
        open={deletingCost !== null}
        onOpenChange={(next) => !next && setDeletingCost(null)}
        title={`Delete Typed cost "${deletingCost?.description ?? ""}"?`}
        description="It stops counting and cannot be brought back."
        confirmLabel="Delete"
        tone="destructive"
        onConfirm={async () => {
          const id = deletingCost.id;
          setDeletingCost(null);
          if (await actions.deleteTypedCost(id)) setCost(undefined);
        }}
      />
      <ConfirmDialog
        open={removingP0 !== null}
        onOpenChange={(next) => !next && setRemovingP0(null)}
        title={`Remove ${removingP0?.p0_number ?? "P0"}?`}
        description="Its lines leave this report unless a Project tag or the Source Document still brings them in."
        confirmLabel="Remove P0"
        tone="destructive"
        onConfirm={() => {
          const id = removingP0.id;
          setRemovingP0(null);
          actions.removeP0(id);
        }}
      />
      <LeaveOutDialog expense={leaving} onOpenChange={(next) => !next && setLeaving(null)} onConfirm={(e, note) => actions.setLeftOut(e.analyticLineId, true, note)} />
    </>
  );
}
