import { useCallback, useEffect, useMemo } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { opexReportService } from "@/services/opexReportService";
import { costingMatrixService } from "@/services/costingMatrixService";
import { normalizePoNumber } from "@/constants/procurement";
import { NO_EDITS, applyEdits, reportSummary, snapshotFrom } from "@/utils/opexReport";

/**
 * One OPEX Report's data (spec #1241, redesign 2026-11-26).
 *
 * Opening is quick on purpose:
 * - the report, its snapshot and its hand edits come back in one request;
 * - the saved snapshot's figures show at once, while Odoo is read;
 * - an Odoo read is kept for five minutes, so reopening a report does not read Odoo again
 *   (Read again always does);
 * - hovering a row on the list starts both reads before the click.
 *
 * Every read and every edit saves the snapshot the list shows.
 */

export const opexKeys = {
  list: ["opex-reports"],
  settings: ["opex-settings"],
  report: (s0) => ["opex-report", s0],
  read: (s0, hand) => ["opex-read", s0, hand],
  savedSnapshot: (reportId) => ["opex-snapshot-saved", reportId],
};

const READ_FRESH_MS = 5 * 60 * 1000;

const handKey = (handP0s) =>
  (handP0s ?? [])
    .map((h) => h.p0_number)
    .sort()
    .join(",");

const reportOptions = (s0) => ({ queryKey: opexKeys.report(s0), queryFn: () => opexReportService.getReport(s0), staleTime: 30_000 });

const readOptions = (s0, hand) => ({
  queryKey: opexKeys.read(s0, hand),
  queryFn: () => opexReportService.readFromOdoo(s0, hand ? hand.split(",") : []),
  staleTime: READ_FRESH_MS,
  gcTime: READ_FRESH_MS * 2,
  retry: false,
  refetchOnWindowFocus: false,
});

export function useOpexSettings() {
  return useQuery({ queryKey: opexKeys.settings, queryFn: () => costingMatrixService.getSettings(), staleTime: READ_FRESH_MS });
}

/** Starts the report read, then the Odoo read, while the pointer rests on a list row. */
export function usePrefetchOpexReport() {
  const queryClient = useQueryClient();
  return useCallback(
    async (s0) => {
      try {
        const data = await queryClient.fetchQuery(reportOptions(s0));
        if (data) queryClient.prefetchQuery(readOptions(s0, handKey(data.edits.handP0s)));
      } catch {
        // A failed head start is not an error: opening the report reads again and says so.
      }
    },
    [queryClient],
  );
}

const num = (v) => (v === null || v === undefined ? null : Number(v));

export function useOpexReport(s0) {
  const queryClient = useQueryClient();
  const reportQuery = useQuery(reportOptions(s0));
  const report = reportQuery.data?.report ?? null;
  const saved = reportQuery.data?.snapshot ?? null;
  const edits = reportQuery.data?.edits ?? NO_EDITS;
  const hand = handKey(edits.handP0s);

  const readQuery = useQuery({ ...readOptions(s0, hand), enabled: Boolean(report), placeholderData: keepPreviousData });
  const settingsQuery = useOpexSettings();
  const read = readQuery.isError ? null : (readQuery.data ?? null);
  const settings = settingsQuery.data ?? null;

  const view = useMemo(() => (read ? { ...read, ...applyEdits(read, edits) } : null), [read, edits]);
  const summary = useMemo(() => (view && settings ? reportSummary(view, report, settings) : null), [view, report, settings]);

  // Every read and every edit saves the snapshot, so the list shows the new figures. The same
  // figures are not saved twice (reopening a report inside five minutes saves nothing).
  const snapshotKey = summary && read ? JSON.stringify(snapshotFrom(read, summary)) : null;
  const reportId = report?.id ?? null;
  useEffect(() => {
    if (!snapshotKey || !reportId) return;
    const savedKey = opexKeys.savedSnapshot(reportId);
    if (queryClient.getQueryData(savedKey) === snapshotKey) return;
    queryClient.setQueryData(savedKey, snapshotKey);
    opexReportService
      .saveSnapshot(reportId, JSON.parse(snapshotKey))
      .then(() => queryClient.invalidateQueries({ queryKey: opexKeys.list }))
      .catch(() => {
        queryClient.removeQueries({ queryKey: savedKey });
        toast.error("The OPEX list could not be updated.");
      });
  }, [snapshotKey, reportId, queryClient]);

  // The figures to show now: worked from Odoo once read, the saved snapshot before that.
  const quick = summary
    ? { ...summary, fromSnapshot: false }
    : saved
      ? {
          contractPrice: num(saved.contract_price),
          productCost: num(saved.product_cost),
          operationAdmin: num(saved.operation_admin),
          marketing: num(saved.marketing),
          actualOpex: num(saved.actual_opex),
          revenue: num(saved.revenue),
          revenuePercent: num(saved.revenue_percent),
          fromSnapshot: true,
          savedAt: saved.read_at,
        }
      : null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: opexKeys.report(s0) });

  // A hand edit: saved, then the report re-read. A failure is a toast; nothing changes on screen.
  const run = async (action, failure) => {
    try {
      await action();
      await refresh();
      return true;
    } catch {
      toast.error(failure);
      return false;
    }
  };

  const actions = {
    /** A hand-added P0 must exist in Odoo; nothing is stored when it does not. */
    async addP0(text) {
      const p0 = normalizePoNumber(text);
      try {
        if (!(await opexReportService.p0ExistsInOdoo(p0))) {
          toast.error(`Odoo has no P0 ${p0}, so it was not added.`);
          return false;
        }
      } catch (e) {
        toast.error(`Odoo could not be asked about ${p0}, so it was not added. ${e?.message ?? ""}`.trim());
        return false;
      }
      return run(() => opexReportService.addP0(reportId, p0), "The P0 could not be added.");
    },
    removeP0: (id) => run(() => opexReportService.removeP0(id), "The P0 could not be removed."),
    setLinePrice: (lineId, price) =>
      run(() => opexReportService.setLinePrice(reportId, lineId, price), price === null ? "The price could not be cleared." : "The price could not be saved."),
    setLeftOut: (analyticLineId, leaveOut, note) =>
      run(
        () => opexReportService.setLeftOut(reportId, analyticLineId, leaveOut, note),
        leaveOut ? "The expense could not be left out." : "The expense could not be put back.",
      ),
    saveTypedCost: (cost) => run(() => opexReportService.saveTypedCost(reportId, cost), "The Typed cost could not be saved."),
    deleteTypedCost: (id) => run(() => opexReportService.deleteTypedCost(id), "The Typed cost could not be deleted."),
    /** Contract price or retention typed in its box. Throws, so the box shows why. */
    async setField(field, value) {
      await opexReportService.setReportField(reportId, field, value);
      await refresh();
    },
    readAgain: () => readQuery.refetch(),
  };

  return { report, saved, edits, reportQuery, readQuery, read, view, summary, quick, settings, actions };
}
