import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useParams } from "react-router";
import toast from "react-hot-toast";
import { AlertTriangle, Pencil, Plus, RefreshCw, Trash2, Undo2 } from "lucide-react";

import ProtectedRoute from "../../../components/ProtectedRoute";
import PageShell from "../../../components/ui/PageShell";
import EmptyState from "../../../components/ui/EmptyState";
import QueryError from "../../../components/ui/QueryError";
import PageLoading from "../../../components/ui/PageLoading";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { SelectField } from "../../../components/ui/SelectField";
import ConfirmDialog from "../../../components/ui/ConfirmDialog";
import { Tooltip } from "../../../components/ui/Tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { useAuth } from "../../../context/AuthContext";
import { getPermissionContext } from "../../../utils/permissions";
import { opexReportService } from "../../../services/opexReportService";
import { costingMatrixService } from "../../../services/costingMatrixService";
import { normalizePoNumber } from "../../../constants/procurement";
import {
  COST_GROUP,
  COST_GROUPS,
  DEFAULT_COST_GROUP,
  NO_EDITS,
  applyEdits,
  formatPesos,
  normalizeS0,
  parseTyped,
  reportSummary,
  snapshotFrom,
} from "../../../utils/opexReport";

/**
 * One OPEX Report (#1244, spec #1241): the header, the P0 lines, the expenses grouped into
 * Operation & Admin and Marketing, Typed costs and the summary. Opening the page, or pressing
 * Read again, reads Odoo. Finance's hand edits (#1245) sit over the read: each one is marked
 * on screen, and each one moves the summary and the snapshot the list shows.
 */

const HEAD = "text-label font-bold uppercase tracking-wider";
const when = (value) => new Date(value).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });
const TYPED_MARK = "rounded bg-amber-a3 px-1.5 py-0.5 text-xs font-medium text-amber-11";

const GROUPS = COST_GROUPS.filter((g) => g.key !== COST_GROUP.PRODUCT);
const GROUP_OPTIONS = COST_GROUPS.map((g) => ({ value: g.key, label: g.label }));
const groupLabel = (key) => COST_GROUPS.find((g) => g.key === key)?.label ?? key;

function IconAction({ label, onClick, children }) {
  return (
    <Tooltip content={label}>
      <Button size="icon-sm" variant="ghost" aria-label={label} onClick={onClick}>
        {children}
      </Button>
    </Tooltip>
  );
}

function P0LinesTable({ lines, onPrice }) {
  if (lines.length === 0) {
    return <EmptyState title="No P0 lines" description="Odoo has no P0 line tagged to this S0, or named by a P0's Source Document." />;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <Table tableId="opex-p0-lines" className="md:min-w-[56rem]">
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className={HEAD}>P0</TableHead>
            <TableHead className={HEAD}>Supplier</TableHead>
            <TableHead className={HEAD}>State</TableHead>
            <TableHead className={HEAD}>Product</TableHead>
            <TableHead className={`${HEAD} text-right`}>Qty</TableHead>
            <TableHead className={`${HEAD} text-right`}>Share</TableHead>
            <TableHead className={`${HEAD} text-right`}>Pesos</TableHead>
            <TableHead className={`${HEAD} text-right`}>Counted</TableHead>
            <TableHead className={HEAD}>Marks</TableHead>
            <TableHead className={HEAD} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => {
            const greyed = line.marks.includes("draft/cancelled") || line.marks.includes("other project");
            return (
              <TableRow key={line.lineId} className={greyed ? "opacity-50" : ""} data-greyed={greyed ? "true" : undefined}>
                <TableCell className="font-mono">{line.p0}</TableCell>
                <TableCell>{line.supplier}</TableCell>
                <TableCell>{line.p0State}</TableCell>
                <TableCell>{line.product}</TableCell>
                <TableCell className="text-right">{line.quantity}</TableCell>
                <TableCell className="text-right">{line.sharePercent}%</TableCell>
                <TableCell className="text-right">{formatPesos(line.pesos)}</TableCell>
                <TableCell className="text-right">{formatPesos(line.countedPesos)}</TableCell>
                <TableCell>
                  {line.marks.includes("typed") ? (
                    <>
                      {line.marks.filter((m) => m !== "typed").join(", ")} <span className={TYPED_MARK}>typed</span>
                    </>
                  ) : (
                    line.marks.join(", ")
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  {line.canType && (
                    <>
                      <IconAction label={`${line.typedPrice == null ? "Type" : "Change"} unit price for ${line.p0} ${line.product}`} onClick={() => onPrice(line)}>
                        <Pencil size={14} />
                      </IconAction>
                      {line.typedPrice != null && (
                        <IconAction label={`Clear typed price for ${line.p0} ${line.product}`} onClick={() => onPrice(line, true)}>
                          <Undo2 size={14} />
                        </IconAction>
                      )}
                    </>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function ExpensesTable({ expenses, onLeaveOut, onPutBack }) {
  if (expenses.length === 0) {
    return <EmptyState title="No expenses" description="Odoo has no petty-cash or bank expense tagged to this S0." />;
  }
  return (
    <div className="space-y-4">
      {GROUPS.map(({ key, label }) => {
        const rows = expenses.filter((e) => (key === COST_GROUP.MARKETING ? e.group === COST_GROUP.MARKETING : e.group !== COST_GROUP.MARKETING));
        return (
          <section key={key} aria-label={label} className="space-y-2">
            <h3 className="text-sm font-semibold">{label}</h3>
            {rows.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing in this group.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-border bg-card">
                <Table tableId={`opex-expenses-${key}`} className="md:min-w-[40rem]">
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className={HEAD}>Date</TableHead>
                      <TableHead className={HEAD}>Description</TableHead>
                      <TableHead className={HEAD}>Odoo account</TableHead>
                      <TableHead className={`${HEAD} text-right`}>Amount</TableHead>
                      <TableHead className={HEAD} />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((e) => {
                      const out = e.leftOut ? "line-through opacity-60" : "";
                      return (
                        <TableRow key={e.analyticLineId} data-left-out={e.leftOut ? "true" : undefined}>
                          <TableCell className={out}>{e.date ?? "—"}</TableCell>
                          <TableCell>
                            <span className={out}>{e.description}</span>
                            {e.leftOut && (
                              <Tooltip content={e.leftOutNote || "Left out by Finance"}>
                                <span className={`${TYPED_MARK} ml-2`}>left out</span>
                              </Tooltip>
                            )}
                          </TableCell>
                          <TableCell className={out}>{e.account}</TableCell>
                          <TableCell className={`text-right ${out}`}>{formatPesos(e.amount)}</TableCell>
                          <TableCell className="text-right">
                            {e.leftOut ? (
                              <IconAction label={`Put back ${e.description}`} onClick={() => onPutBack(e)}>
                                <Undo2 size={14} />
                              </IconAction>
                            ) : (
                              <IconAction label={`Leave out ${e.description}`} onClick={() => onLeaveOut(e)}>
                                <Trash2 size={14} />
                              </IconAction>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function TypedCostsTable({ costs, onEdit, onDelete }) {
  if (costs.length === 0) return <p className="text-xs text-muted-foreground">No Typed costs.</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <Table tableId="opex-typed-costs" className="md:min-w-[40rem]">
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className={HEAD}>Date</TableHead>
            <TableHead className={HEAD}>Description</TableHead>
            <TableHead className={HEAD}>Group</TableHead>
            <TableHead className={HEAD}>Note</TableHead>
            <TableHead className={`${HEAD} text-right`}>Amount</TableHead>
            <TableHead className={HEAD} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {costs.map((c) => (
            <TableRow key={c.id}>
              <TableCell>{c.cost_date ?? "—"}</TableCell>
              <TableCell>
                {c.description} <span className={TYPED_MARK}>typed</span>
              </TableCell>
              <TableCell>{groupLabel(c.group)}</TableCell>
              <TableCell>{c.note ?? ""}</TableCell>
              <TableCell className="text-right">{formatPesos(c.amount)}</TableCell>
              <TableCell className="whitespace-nowrap text-right">
                <IconAction label={`Edit Typed cost ${c.description}`} onClick={() => onEdit(c)}>
                  <Pencil size={14} />
                </IconAction>
                <IconAction label={`Delete Typed cost ${c.description}`} onClick={() => onDelete(c)}>
                  <Trash2 size={14} />
                </IconAction>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const SUMMARY_ROWS = [
  ["Contract price", "contractPrice", "contract_price"],
  ["VAT-exclusive", "vatExclusive"],
  ["Tax withheld", "tax"],
  ["Retention", "retention", "retention"],
  ["Collected", "collected"],
  ["Product cost", "productCost"],
  ["Operation & Admin", "operationAdmin"],
  ["Marketing", "marketing"],
  ["Actual OPEX", "actualOpex"],
  ["ITR", "itr"],
  ["Revenue", "revenue"],
];

function Summary({ summary, report, onEdit }) {
  return (
    <dl className="grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-sm">
      {SUMMARY_ROWS.map(([label, key, field]) => {
        const typed = field && report?.[field] != null;
        return (
          <div key={key} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="flex items-center justify-end gap-1.5 text-right font-medium">
              {typed && <span className={TYPED_MARK}>typed</span>}
              {formatPesos(summary[key])}
              {field && (
                <IconAction label={`Edit ${label}`} onClick={() => onEdit(field, label)}>
                  <Pencil size={14} />
                </IconAction>
              )}
            </dd>
          </div>
        );
      })}
      <dt className="text-muted-foreground">Revenue %</dt>
      <dd className="text-right font-medium">{summary.revenuePercent == null ? "—" : `${summary.revenuePercent}%`}</dd>
    </dl>
  );
}

const blankCost = { id: null, cost_date: "", description: "", amount: "", note: "", cost_group: DEFAULT_COST_GROUP };

function OpexReportView({ s0 }) {
  const queryClient = useQueryClient();
  // One open dialog at a time: { kind, ...what it is about }.
  const [dialog, setDialog] = useState(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [cost, setCost] = useState(blankCost);

  const reportQuery = useQuery({ queryKey: ["opex-report", s0], queryFn: () => opexReportService.getByS0(s0) });
  const report = reportQuery.data;
  const reportId = report?.id;

  const editsQuery = useQuery({
    queryKey: ["opex-edits", reportId],
    enabled: Boolean(reportId),
    queryFn: () => opexReportService.getEdits(reportId),
  });
  const edits = editsQuery.data ?? NO_EDITS;
  const handP0Key = (edits.handP0s ?? [])
    .map((h) => h.p0_number)
    .sort()
    .join(",");

  // Opening the page reads Odoo; so does Read again, and adding or removing a P0.
  const readQuery = useQuery({
    queryKey: ["opex-read", s0, handP0Key],
    enabled: Boolean(report) && editsQuery.isSuccess,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: () => opexReportService.readFromOdoo(s0, handP0Key ? handP0Key.split(",") : []),
  });
  const settingsQuery = useQuery({ queryKey: ["opex-settings"], queryFn: () => costingMatrixService.getSettings() });
  const read = readQuery.data;

  const view = useMemo(() => (read ? { ...read, ...applyEdits(read, edits) } : null), [read, edits]);
  const summary = useMemo(
    () => (view && settingsQuery.data ? reportSummary(view, report, settingsQuery.data) : null),
    [view, report, settingsQuery.data],
  );

  // Every read and every edit saves the snapshot, so the OPEX list shows the new figures.
  const snapshotKey = summary ? JSON.stringify(snapshotFrom(read, summary)) : null;
  useEffect(() => {
    if (!snapshotKey || !reportId) return;
    opexReportService
      .saveSnapshot(reportId, JSON.parse(snapshotKey))
      .then(() => queryClient.invalidateQueries({ queryKey: ["opex-reports"] }))
      .catch(() => toast.error("The OPEX list could not be updated."));
  }, [snapshotKey, reportId, queryClient]);

  const close = () => setDialog(null);
  const run = async (action, failure) => {
    try {
      await action();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["opex-edits", reportId] }),
        queryClient.invalidateQueries({ queryKey: ["opex-report", s0] }),
      ]);
      close();
    } catch {
      toast.error(failure);
    }
  };

  const openDialog = (next, nextText = "", nextNote = "") => {
    setText(nextText);
    setNote(nextNote);
    setDialog(next);
  };

  const openCost = (c) => {
    setCost(
      c
        ? { id: c.id, cost_date: c.cost_date ?? "", description: c.description, amount: String(c.amount), note: c.note ?? "", cost_group: c.group }
        : blankCost,
    );
    setDialog({ kind: "cost" });
  };

  const onPrice = (line, clear = false) => {
    if (clear) return openDialog({ kind: "clearPrice", line });
    return openDialog({ kind: "price", line }, line.typedPrice == null ? "" : String(line.typedPrice));
  };

  if (reportQuery.isLoading) {
    return (
      <PageShell title={`OPEX Report ${s0}`}>
        <PageLoading label="OPEX Report" />
      </PageShell>
    );
  }
  if (reportQuery.isError) {
    return (
      <PageShell title={`OPEX Report ${s0}`}>
        <QueryError title="The OPEX Report could not be loaded." onRetry={reportQuery.refetch} />
      </PageShell>
    );
  }
  if (!report) {
    return (
      <PageShell title={`OPEX Report ${s0}`}>
        <EmptyState title={`No OPEX Report for ${s0}`} description="Start one from the OPEX page." />
      </PageShell>
    );
  }

  // A hand-added P0 must exist in Odoo; nothing is stored when it does not.
  const addP0 = async () => {
    const p0 = normalizePoNumber(text);
    try {
      if (!(await opexReportService.p0ExistsInOdoo(p0))) {
        toast.error(`Odoo has no P0 ${p0}, so it was not added.`);
        return;
      }
    } catch (e) {
      toast.error(`Odoo could not be asked about ${p0}, so it was not added. ${e.message ?? ""}`.trim());
      return;
    }
    await run(() => opexReportService.addP0(reportId, p0), "The P0 could not be added.");
  };

  const typedFigure = parseTyped(text);
  const badFigure = Number.isNaN(typedFigure) || (typedFigure !== null && typedFigure < 0);
  const costAmount = parseTyped(cost.amount);
  const orphanCount = (view?.orphans.linePrices.length ?? 0) + (view?.orphans.leftOut.length ?? 0);

  return (
    <PageShell
      title={`OPEX Report ${s0}`}
      description={read ? (read.projectName ?? "No project name: Odoo has no Project tag for this S0.") : undefined}
      action={
        <div className="flex items-center gap-3">
          {read && <span className="text-xs text-muted-foreground">Odoo read at {when(read.readAt)}</span>}
          <Button size="sm" variant="outline" className="gap-1.5" disabled={readQuery.isFetching} onClick={() => readQuery.refetch()}>
            <RefreshCw size={14} className={readQuery.isFetching ? "animate-spin" : ""} />
            Read again
          </Button>
        </div>
      }
    >
      {readQuery.isFetching && !read && <PageLoading label="Odoo" />}
      {readQuery.isError && (
        <div role="alert" className="rounded-xl border border-red-6 bg-red-a2 px-5 py-4 text-sm text-red-11">
          Odoo could not be read, so no figures are shown. {readQuery.error?.message}
        </div>
      )}

      {read?.noProjectTag && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-amber-6 bg-amber-a2 px-4 py-3 text-sm">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>Odoo has no Project tag for {s0}. This report shows only P0s whose Source Document names it.</span>
        </div>
      )}

      {view && (
        <div className="space-y-6">
          <section aria-label="P0 lines" className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">P0 lines</h2>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openDialog({ kind: "addP0" })}>
                <Plus size={14} />
                Add P0
              </Button>
            </div>
            {view.handP0s.length > 0 && (
              <ul aria-label="Added P0s" className="flex flex-wrap gap-2">
                {view.handP0s.map((h) => (
                  <li key={h.id} className="flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-sm">
                    <span className="font-mono">{h.p0_number}</span>
                    <span className={TYPED_MARK}>typed</span>
                    {h.missing && <span className="text-xs text-red-11">no longer in Odoo</span>}
                    <IconAction label={`Remove ${h.p0_number}`} onClick={() => openDialog({ kind: "removeP0", p0: h })}>
                      <Trash2 size={14} />
                    </IconAction>
                  </li>
                ))}
              </ul>
            )}
            <P0LinesTable lines={view.lines} onPrice={onPrice} />
          </section>
          <section aria-label="Expenses" className="space-y-2">
            <h2 className="text-base font-semibold">Expenses</h2>
            <ExpensesTable
              expenses={view.expenses}
              onLeaveOut={(e) => openDialog({ kind: "leaveOut", expense: e })}
              onPutBack={(e) => run(() => opexReportService.setLeftOut(reportId, e.analyticLineId, false), "The expense could not be put back.")}
            />
          </section>
          <section aria-label="Typed costs" className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Typed costs</h2>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openCost(null)}>
                <Plus size={14} />
                Add Typed cost
              </Button>
            </div>
            <TypedCostsTable costs={view.typedCosts} onEdit={openCost} onDelete={(c) => openDialog({ kind: "deleteCost", cost: c })} />
          </section>
          {orphanCount > 0 && (
            <section aria-label="No longer in Odoo" className="space-y-2">
              <h2 className="text-base font-semibold">No longer in Odoo</h2>
              <ul className="space-y-1 text-sm">
                {view.orphans.linePrices.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 opacity-70">
                    Typed price {formatPesos(p.unit_price)} for P0 line {p.odoo_line_id}
                    <span className="text-xs text-red-11">no longer in Odoo, not counted</span>
                    <IconAction
                      label={`Remove typed price for line ${p.odoo_line_id}`}
                      onClick={() => run(() => opexReportService.setLinePrice(reportId, Number(p.odoo_line_id), null), "The typed price could not be removed.")}
                    >
                      <Trash2 size={14} />
                    </IconAction>
                  </li>
                ))}
                {view.orphans.leftOut.map((l) => (
                  <li key={l.id} className="flex items-center gap-2 opacity-70">
                    Left-out expense {l.analytic_line_id}
                    <span className="text-xs text-red-11">no longer in Odoo, not counted</span>
                    <IconAction
                      label={`Remove left-out expense ${l.analytic_line_id}`}
                      onClick={() => run(() => opexReportService.setLeftOut(reportId, Number(l.analytic_line_id), false), "The left-out expense could not be removed.")}
                    >
                      <Trash2 size={14} />
                    </IconAction>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section aria-label="Summary" className="space-y-2">
            <h2 className="text-base font-semibold">Summary</h2>
            {summary && (
              <Summary
                summary={summary}
                report={report}
                onEdit={(field, label) => openDialog({ kind: "field", field, label }, report[field] == null ? "" : String(report[field]))}
              />
            )}
          </section>
        </div>
      )}

      <ConfirmDialog
        open={dialog?.kind === "addP0"}
        onOpenChange={(o) => !o && close()}
        title="Add a P0"
        confirmLabel="Add P0"
        confirmDisabled={!/^[A-Z]+\d+$/.test(normalizePoNumber(text))}
        onConfirm={addP0}
      >
        <Input label="P0 number" placeholder="e.g. P02367" value={text} onChange={(e) => setText(e.target.value)} />
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.kind === "removeP0"}
        onOpenChange={(o) => !o && close()}
        title={`Remove ${dialog?.p0?.p0_number ?? "P0"}?`}
        confirmLabel="Remove P0"
        tone="destructive"
        onConfirm={() => run(() => opexReportService.removeP0(dialog.p0.id), "The P0 could not be removed.")}
      />

      <ConfirmDialog
        open={dialog?.kind === "price"}
        onOpenChange={(o) => !o && close()}
        title={`Unit price for ${dialog?.line?.p0 ?? ""} ${dialog?.line?.product ?? ""}`}
        confirmLabel="Save price"
        confirmDisabled={typedFigure === null || badFigure}
        onConfirm={() => run(() => opexReportService.setLinePrice(reportId, dialog.line.lineId, typedFigure), "The price could not be saved.")}
      >
        <Tooltip content="Type the price in pesos. A foreign P0's price is taken in pesos too, not in the P0's own currency.">
          <div>
            <Input label="Unit price (pesos)" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} />
          </div>
        </Tooltip>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.kind === "clearPrice"}
        onOpenChange={(o) => !o && close()}
        title="Clear the typed price?"
        description="The line goes back to Odoo's zero, with the zero-price warning."
        confirmLabel="Clear price"
        onConfirm={() => run(() => opexReportService.setLinePrice(reportId, dialog.line.lineId, null), "The price could not be cleared.")}
      />

      <ConfirmDialog
        open={dialog?.kind === "leaveOut"}
        onOpenChange={(o) => !o && close()}
        title={`Leave out ${dialog?.expense?.description ?? "this expense"}?`}
        confirmLabel="Leave out"
        onConfirm={() => run(() => opexReportService.setLeftOut(reportId, dialog.expense.analyticLineId, true, note), "The expense could not be left out.")}
      >
        <Input label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.kind === "cost"}
        onOpenChange={(o) => !o && close()}
        title={cost.id ? "Edit Typed cost" : "Add Typed cost"}
        confirmLabel="Save Typed cost"
        confirmDisabled={!cost.description.trim() || costAmount === null || Number.isNaN(costAmount)}
        onConfirm={() =>
          run(
            () => opexReportService.saveTypedCost(reportId, { ...cost, description: cost.description.trim(), amount: costAmount }),
            "The Typed cost could not be saved.",
          )
        }
      >
        <div className="space-y-3">
          <Input label="Date" type="date" value={cost.cost_date} onChange={(e) => setCost({ ...cost, cost_date: e.target.value })} />
          <Input label="Description" value={cost.description} onChange={(e) => setCost({ ...cost, description: e.target.value })} />
          <Input label="Amount (pesos)" inputMode="decimal" value={cost.amount} onChange={(e) => setCost({ ...cost, amount: e.target.value })} />
          <Input label="Note" value={cost.note} onChange={(e) => setCost({ ...cost, note: e.target.value })} />
          <SelectField label="Counts as" options={GROUP_OPTIONS} value={cost.cost_group} onChange={(v) => setCost({ ...cost, cost_group: v })} />
        </div>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog?.kind === "deleteCost"}
        onOpenChange={(o) => !o && close()}
        title={`Delete Typed cost ${dialog?.cost?.description ?? ""}?`}
        confirmLabel="Delete"
        tone="destructive"
        onConfirm={() => run(() => opexReportService.deleteTypedCost(dialog.cost.id), "The Typed cost could not be deleted.")}
      />

      <ConfirmDialog
        open={dialog?.kind === "field"}
        onOpenChange={(o) => !o && close()}
        title={dialog?.label ?? ""}
        description={
          dialog?.field === "retention"
            ? "Type what the client really kept, zero included. Leave it blank to use the retention rate."
            : "Type the exact contract figure. Leave it blank to use Odoo's."
        }
        confirmLabel="Save"
        confirmDisabled={badFigure}
        onConfirm={() => run(() => opexReportService.setReportField(reportId, dialog.field, typedFigure), "The figure could not be saved.")}
      >
        <Input label={`${dialog?.label ?? ""} (pesos)`} inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} />
      </ConfirmDialog>
    </PageShell>
  );
}

export default function OpexReportPage() {
  const { user } = useAuth();
  const { s0: param } = useParams();
  const { isSuperAdmin, hasFinanceFlow } = getPermissionContext(user);
  if (user && !(isSuperAdmin || hasFinanceFlow)) return <Navigate to="/" replace />;
  const s0 = normalizeS0(param);
  if (!s0) return <Navigate to="/finance/opex" replace />;
  return (
    <ProtectedRoute>
      <OpexReportView s0={s0} />
    </ProtectedRoute>
  );
}
