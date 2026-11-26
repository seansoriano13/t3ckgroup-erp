// PROTOTYPE (throwaway): data for the three OPEX redesign options. Not production code.
//
// What it changes about loading, so every option opens fast:
// 1. The report row and its four hand-edit tables come back in ONE request (the page made two, one after the other).
// 2. The figures saved on the list (the snapshot) show at once; the Odoo read fills in the lines when it lands.
// 3. The Odoo read is kept for 5 minutes, so reopening a report or switching option does not read Odoo again.
// 4. Hovering a row on the list starts the reads before the click.
//
// Edits are a STUB: they live in this browser tab only and are never saved.

import { useCallback, useMemo } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { supabase } from "../../../../lib/supabase";
import { opexReportService } from "../../../../services/opexReportService";
import { costingMatrixService } from "../../../../services/costingMatrixService";
import { normalizePoNumber } from "../../../../constants/procurement";
import { NO_EDITS, applyEdits, formatPesos, reportSummary } from "../../../../utils/opexReport";

export const peso = formatPesos;
const READ_FRESH_MS = 5 * 60 * 1000;

export const keys = {
  list: ["opex-reports"],
  settings: ["opex-settings"],
  record: (s0) => ["opex-proto-record", s0],
  read: (s0, hand) => ["opex-proto-read", s0, hand],
  stub: (s0) => ["opex-proto-stub", s0],
};

async function readRecord(s0) {
  const { data, error } = await supabase
    .from("opex_reports")
    .select(
      "id, s0_number, contract_price, retention, created_at, snapshot:opex_report_snapshots(*), handP0s:opex_report_p0s(*), typedCosts:opex_typed_costs(*), linePrices:opex_line_prices(*), leftOut:opex_left_out_expenses(*)",
    )
    .eq("s0_number", s0)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const one = (v) => (Array.isArray(v) ? (v[0] ?? null) : v);
  return { ...data, snapshot: one(data.snapshot) };
}

const handKey = (handP0s) =>
  (handP0s ?? [])
    .map((h) => h.p0_number)
    .sort()
    .join(",");

const readOptions = (s0, hand) => ({
  queryKey: keys.read(s0, hand),
  queryFn: () => opexReportService.readFromOdoo(s0, hand ? hand.split(",") : []),
  staleTime: READ_FRESH_MS,
  gcTime: READ_FRESH_MS * 2,
  retry: false,
  refetchOnWindowFocus: false,
});

/** Starts both reads while the pointer rests on a row. */
export function usePrefetchReport() {
  const queryClient = useQueryClient();
  return useCallback(
    async (s0) => {
      const record = await queryClient.fetchQuery({ queryKey: keys.record(s0), queryFn: () => readRecord(s0), staleTime: 30_000 });
      if (record) queryClient.prefetchQuery(readOptions(s0, handKey(record.handP0s)));
    },
    [queryClient],
  );
}

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: () => costingMatrixService.getSettings(), staleTime: Infinity });
}

/** The list's rows, shaped once for every option. */
export function useListRows() {
  const listQuery = useQuery({ queryKey: keys.list, queryFn: () => opexReportService.list() });
  const { data: settings } = useSettings();
  const goLine = Number(settings?.goLinePercent ?? 20);
  const rows = useMemo(
    () =>
      (listQuery.data ?? []).map((row) => {
        const s = row.snapshot ?? {};
        const pct = s.revenue_percent == null ? null : Number(s.revenue_percent);
        const revenue = s.revenue == null ? null : Number(s.revenue);
        const health = pct === null ? "unread" : revenue < 0 ? "loss" : pct < goLine ? "below" : "on_target";
        return {
          id: row.id,
          s0: row.s0_number,
          project: s.project_name ?? null,
          contract: s.contract_price == null ? null : Number(s.contract_price),
          product: s.product_cost == null ? null : Number(s.product_cost),
          opsAdmin: s.operation_admin == null ? null : Number(s.operation_admin),
          marketing: s.marketing == null ? null : Number(s.marketing),
          actualOpex: s.actual_opex == null ? null : Number(s.actual_opex),
          revenue,
          pct,
          readAt: s.read_at ?? null,
          health,
        };
      }),
    [listQuery.data, goLine],
  );
  return { ...listQuery, rows, goLine };
}

export const HEALTH = {
  on_target: { label: "On target", theme: "green" },
  below: { label: "Below go line", theme: "amber" },
  loss: { label: "Loss", theme: "red" },
  unread: { label: "Not read yet", theme: "mauve" },
};

export const sumOf = (rows, key) => {
  const vals = rows.map((r) => r[key]).filter((v) => v !== null && v !== undefined);
  return vals.length ? Math.round(vals.reduce((a, b) => a + b * 100, 0)) / 100 : null;
};

/**
 * One report: the saved row and edits (one request), the Odoo read (kept 5 minutes), and the stub
 * edits on top. `quick` is the figures to show right now: the worked summary once Odoo is read,
 * the saved snapshot before that.
 */
export function useReport(s0) {
  const queryClient = useQueryClient();
  const recordQuery = useQuery({ queryKey: keys.record(s0), queryFn: () => readRecord(s0), staleTime: 30_000, enabled: Boolean(s0) });
  const record = recordQuery.data ?? null;

  // The stub: null until something is changed here.
  const stubQuery = useQuery({ queryKey: keys.stub(s0), queryFn: () => null, staleTime: Infinity, gcTime: Infinity, enabled: Boolean(s0) });
  const stub = stubQuery.data ?? null;

  const saved = useMemo(
    () =>
      record
        ? {
            handP0s: record.handP0s ?? [],
            typedCosts: record.typedCosts ?? [],
            linePrices: record.linePrices ?? [],
            leftOut: record.leftOut ?? [],
            contract_price: record.contract_price,
            retention: record.retention,
          }
        : { ...NO_EDITS, contract_price: null, retention: null },
    [record],
  );
  const edits = stub ?? saved;
  const hand = handKey(edits.handP0s);

  const readQuery = useQuery({ ...readOptions(s0, hand), enabled: Boolean(record), placeholderData: keepPreviousData });
  const { data: settings } = useSettings();
  const read = readQuery.data ?? null;

  const view = useMemo(() => (read ? { ...read, ...applyEdits(read, edits) } : null), [read, edits]);
  const report = useMemo(() => ({ contract_price: edits.contract_price, retention: edits.retention }), [edits]);
  const summary = useMemo(() => (view && settings ? reportSummary(view, report, settings) : null), [view, report, settings]);

  const snap = record?.snapshot;
  const quick = summary
    ? { ...summary, fromSnapshot: false }
    : snap
      ? {
          contractPrice: num(snap.contract_price),
          productCost: num(snap.product_cost),
          operationAdmin: num(snap.operation_admin),
          marketing: num(snap.marketing),
          actualOpex: num(snap.actual_opex),
          revenue: num(snap.revenue),
          revenuePercent: num(snap.revenue_percent),
          fromSnapshot: true,
          savedAt: snap.read_at,
        }
      : null;

  const change = (fn) => {
    const current = queryClient.getQueryData(keys.stub(s0)) ?? saved;
    queryClient.setQueryData(keys.stub(s0), fn(structuredClone(current)));
  };
  const localId = () => `local-${Math.random().toString(36).slice(2, 9)}`;

  const actions = {
    async addP0(text) {
      const p0 = normalizePoNumber(text);
      try {
        if (!(await opexReportService.p0ExistsInOdoo(p0))) {
          toast.error(`Odoo has no P0 ${p0}, so it was not added.`);
          return false;
        }
      } catch {
        toast.error(`Odoo could not be asked about ${p0}, so it was not added.`);
        return false;
      }
      change((e) => {
        if (!e.handP0s.some((h) => h.p0_number === p0)) e.handP0s.push({ id: localId(), p0_number: p0 });
        return e;
      });
      return true;
    },
    removeP0(id) {
      change((e) => ({ ...e, handP0s: e.handP0s.filter((h) => h.id !== id) }));
    },
    setLinePrice(lineId, unitPrice) {
      change((e) => {
        e.linePrices = e.linePrices.filter((p) => Number(p.odoo_line_id) !== Number(lineId));
        if (unitPrice !== null) e.linePrices.push({ id: localId(), odoo_line_id: lineId, unit_price: unitPrice });
        return e;
      });
    },
    setLeftOut(analyticLineId, leaveOut, note = "") {
      change((e) => {
        e.leftOut = e.leftOut.filter((l) => Number(l.analytic_line_id) !== Number(analyticLineId));
        if (leaveOut) e.leftOut.push({ id: localId(), analytic_line_id: analyticLineId, note: note || null });
        return e;
      });
    },
    saveTypedCost(cost) {
      change((e) => {
        const row = { ...cost, amount: Number(cost.amount), cost_date: cost.cost_date || null, note: cost.note || null };
        if (cost.id) e.typedCosts = e.typedCosts.map((c) => (c.id === cost.id ? { ...c, ...row } : c));
        else e.typedCosts.push({ ...row, id: localId() });
        return e;
      });
    },
    deleteTypedCost(id) {
      change((e) => ({ ...e, typedCosts: e.typedCosts.filter((c) => c.id !== id) }));
    },
    setField(field, value) {
      change((e) => ({ ...e, [field]: value }));
    },
    resetStub() {
      queryClient.setQueryData(keys.stub(s0), null);
    },
  };

  return {
    record,
    recordQuery,
    readQuery,
    read,
    view,
    summary,
    quick,
    settings,
    edits,
    hasStubEdits: stub !== null,
    actions,
  };
}

function num(v) {
  return v === null || v === undefined ? null : Number(v);
}

/** What needs a look on a read: zero-price lines, P0s with no tag, drafts, hand P0s Odoo no longer has. */
export function issuesOf(view) {
  if (!view) return [];
  const out = [];
  for (const l of view.lines) {
    if (l.marks.includes("zero price")) out.push({ key: `zero-${l.lineId}`, kind: "zero", line: l });
  }
  const noTag = [...new Set(view.lines.filter((l) => l.marks.includes("no tag")).map((l) => l.p0))];
  for (const p0 of noTag) out.push({ key: `notag-${p0}`, kind: "notag", p0 });
  for (const h of view.handP0s.filter((h) => h.missing)) out.push({ key: `missing-${h.id}`, kind: "missing", hand: h });
  return out;
}

/** Lines grouped by P0, in order, with each P0's facts. */
export function p0Groups(lines) {
  const map = new Map();
  for (const l of lines) {
    if (!map.has(l.p0)) map.set(l.p0, { p0: l.p0, supplier: l.supplier, state: l.p0State, lines: [] });
    map.get(l.p0).lines.push(l);
  }
  return [...map.values()];
}

export const STATE_WORDS = { draft: "Draft", sent: "RFQ sent", "to approve": "To approve", purchase: "Purchase order", done: "Locked", cancel: "Cancelled" };

/** The one badge a P0 line shows: the mark that matters most. */
export function lineBadge(line) {
  const m = line.marks;
  if (m.includes("typed")) return { label: "Typed price", theme: "blue" };
  if (m.includes("zero price")) return { label: "Zero price", theme: "amber" };
  if (m.includes("draft/cancelled")) return { label: "Not counted", theme: "mauve" };
  if (m.includes("other project")) return { label: "Other project", theme: "mauve" };
  if (m.includes("no tag")) return { label: "No tag", theme: "amber" };
  return null;
}

export const isGreyed = (line) => line.marks.includes("draft/cancelled") || line.marks.includes("other project");

export const unitPriceOf = (line) =>
  line.typedPrice != null ? line.typedPrice : line.quantity ? Math.round((line.pesos / line.quantity) * 100) / 100 : null;

export const pct = (v) => (v === null || v === undefined ? "—" : `${Number(v).toFixed(2)}%`);
