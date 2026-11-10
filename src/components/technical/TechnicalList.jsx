import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ClipboardCheck } from "lucide-react";

import PageShell from "../ui/PageShell";
import EmptyState from "../ui/EmptyState";
import QueryError from "../ui/QueryError";
import PageLoading from "../ui/PageLoading";
import TabGroup from "../ui/TabGroup";
import FilterBar from "../ui/FilterBar";
import StatusBadge from "../StatusBadge";
import HighlightText from "../HighlightText";
import { IdentityCell } from "../purchasing/list/IdentityCell";
import { StateCell, STATE_HEAD_CLASS } from "../purchasing/list/StateCell";
import { SortHead, Table, TableBody, TableCell, TableHeader, TableRow } from "../ui/table";
import { TablePager } from "../ui/TablePager";
import { useAuth } from "../../context/AuthContext";
import { getPermissionContext } from "../../utils/permissions";
import { useTableSort } from "../../hooks/useTableSort";
import { usePaging } from "../../hooks/usePaging";
import { costingMatrixService } from "../../services/costingMatrixService";
import { salesFlowService } from "../../services/salesFlowService";
import { flowStageTonesByName } from "../../constants/salesFlow";
import { COMPLIANCE_LABEL, COMPLIANCE_THEME } from "../../constants/costing";
import { TECHNICAL_TAB, checkedLabel, filterTechnical, judgingProgress, technicalKeys, technicalState } from "../../utils/technicalList";

/**
 * The Technical list (#877), built like the Purchasing lists: To check / Done / All pills, a search, sortable
 * columns, a pager, and a row that opens its sheet in a record window over the list (`selectedId` is the row whose
 * window is open). SOR names and counts only, never money. Someone on the Evaluation list also gets "Waiting for
 * approval" (a verdict in, no approval yet), and opens on it unless they are an in-charge, whose verdicts come first.
 */

const HEAD = "text-label font-bold uppercase tracking-wider";
const STATE_TONES = { to_check: "amber", checked: "blue", approved: "green" };
const NARROW_HIDDEN = new Set(["Stage"]);

const SORT = {
  sor: (r) => r.sorNumber,
  stage: (r) => r.stage,
  progress: (r) => (r.rowsTotal ? r.rowsJudged / r.rowsTotal : null),
  state: (r) => technicalState(r).label,
};
const COLUMNS = [
  ["SOR", "sor"],
  ["Stage", "stage"],
  ["Progress", "progress"],
  ["State", "state"],
];

// One segment per product; a judged product is filled. Once every product is judged the bar becomes the result badge.
function ProgressCell({ row }) {
  if (!row.rowsTotal) return <span className="text-xs text-muted-foreground">No products yet</span>;
  const progress = judgingProgress(row);
  if (progress.done) {
    return (
      <div data-testid="technical-progress">
        <StatusBadge label={COMPLIANCE_LABEL[progress.result]} theme={COMPLIANCE_THEME[progress.result]} title="Technical verdict" />
      </div>
    );
  }
  return (
    <div className="w-full min-w-[8rem]">
      <div className="flex gap-0.5" aria-hidden="true">
        {Array.from({ length: row.rowsTotal }, (_, i) => (
          <span key={i} className={`h-1 flex-1 rounded-full ${i < row.rowsJudged ? "bg-green-9" : "bg-mauve-5"}`} />
        ))}
      </div>
      <p className="mt-1 text-xs tabular-nums text-muted-foreground" data-testid="technical-progress">
        {checkedLabel(row)}
        {progress.deviates > 0 && (
          <span className="ml-2 font-medium text-destructive" data-testid="technical-deviates">
            {progress.deviates} deviates
          </span>
        )}
      </p>
    </div>
  );
}

function TechnicalRow({ row, selected, onOpen, search, stageTones }) {
  const state = technicalState(row);
  return (
    <TableRow
      tabIndex={0}
      aria-selected={selected}
      data-testid="technical-row"
      onClick={() => onOpen(row.opportunityId)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) {
          e.preventDefault();
          onOpen(row.opportunityId);
        }
      }}
      className="group cursor-pointer outline-none focus-visible:bg-muted aria-selected:bg-muted/60"
    >
      <IdentityCell reference={row.sorNumber} name={row.projectTitle} search={search}>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">
          {row.soNumber ? (
            <span className="font-mono">
              <HighlightText text={row.soNumber} search={search} />
            </span>
          ) : null}
          {row.soNumber && row.clientName ? " · " : null}
          <HighlightText text={row.clientName} search={search} />
        </span>
      </IdentityCell>
      <TableCell className="hidden md:table-cell">
        {row.stage ? <StatusBadge label={row.stage} theme={stageTones.get(row.stage) || "mauve"} title={row.stage} /> : <span className="text-xs text-muted-foreground">—</span>}
      </TableCell>
      <TableCell>
        <ProgressCell row={row} />
      </TableCell>
      <StateCell state={state.key} tones={STATE_TONES} label={state.label} />
    </TableRow>
  );
}

export default function TechnicalList({ selectedId = null }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isOnEvaluationList: approves, isTechnicalIncharge: givesVerdicts } = getPermissionContext(user);
  const firstTab = approves && !givesVerdicts ? TECHNICAL_TAB.TO_APPROVE : TECHNICAL_TAB.TO_CHECK;
  const [tab, setTab] = useState(firstTab);
  const [search, setSearch] = useState("");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: technicalKeys.list,
    queryFn: () => costingMatrixService.technicalList(),
    retry: false,
  });
  const rows = useMemo(() => data ?? [], [data]);
  // Every flow's Stages, shared with the SOR list's cache, to colour the Stage column like the Purchasing lists do.
  const { data: flowStagesIndex } = useQuery({ queryKey: ["allFlowStagesIndex"], queryFn: () => salesFlowService.getAllStagesIndex() });
  const stageTones = useMemo(() => flowStageTonesByName(flowStagesIndex), [flowStagesIndex]);

  // Search narrows first; the pills count within that.
  const narrowed = useMemo(() => filterTechnical(rows, { search }), [rows, search]);
  const counts = useMemo(
    () => ({
      [TECHNICAL_TAB.TO_CHECK]: filterTechnical(narrowed, { tab: TECHNICAL_TAB.TO_CHECK }).length,
      [TECHNICAL_TAB.TO_APPROVE]: filterTechnical(narrowed, { tab: TECHNICAL_TAB.TO_APPROVE }).length,
      [TECHNICAL_TAB.DONE]: filterTechnical(narrowed, { tab: TECHNICAL_TAB.DONE }).length,
      [TECHNICAL_TAB.ALL]: narrowed.length,
    }),
    [narrowed],
  );
  const filtered = useMemo(() => filterTechnical(narrowed, { tab }), [narrowed, tab]);
  const { sorted: visible, sort, toggle } = useTableSort(filtered, SORT);
  const paging = usePaging(visible);

  const hasActiveFilters = search !== "" || tab !== firstTab;
  const open = (id) => navigate(`/technical/${id}`);

  const description =
    approves && givesVerdicts
      ? "The S0 Evaluations you give a verdict on, and the ones waiting for your approval."
      : approves
        ? "The S0 Evaluations waiting for your approval. Open one to read the Technical verdict and approve it."
        : "The S0 Evaluations you are the Technical in-charge for. Open one to give its Complies or Deviates verdict.";
  const emptyAtStart = approves ? "S0 Evaluations appear here once a Technical in-charge is named on them." : "S0 Evaluations appear here once Sales or Purchasing names you as their Technical in-charge.";
  const nothingWaiting = rows.length > 0 && tab === TECHNICAL_TAB.TO_APPROVE && search === "";

  const toolbar = (
    <>
      <TabGroup
        variant="pill"
        size="sm"
        activeTab={tab}
        onChange={setTab}
        tabs={[
          { value: TECHNICAL_TAB.TO_CHECK, label: "To check", badge: counts[TECHNICAL_TAB.TO_CHECK] },
          ...(approves ? [{ value: TECHNICAL_TAB.TO_APPROVE, label: "Waiting for approval", badge: counts[TECHNICAL_TAB.TO_APPROVE] }] : []),
          { value: TECHNICAL_TAB.DONE, label: "Done", badge: counts[TECHNICAL_TAB.DONE] },
          { value: TECHNICAL_TAB.ALL, label: "All", badge: counts[TECHNICAL_TAB.ALL] },
        ]}
      />
      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: "Search SO number, SOR number, project or client" }}
        hasActiveFilters={hasActiveFilters}
        onClearAll={() => {
          setSearch("");
          setTab(firstTab);
        }}
      />
    </>
  );

  return (
    <PageShell title="Technical" description={description} toolbar={toolbar}>
      {isLoading && <PageLoading label="Technical" />}

      {isError && <QueryError title="The Technical list could not be loaded." onRetry={refetch} />}

      {!isLoading && !isError && visible.length === 0 && (
        <EmptyState
          icon={ClipboardCheck}
          title={rows.length === 0 ? "Nothing to check yet" : nothingWaiting ? "Nothing waiting for approval" : "No matching SOR"}
          description={
            rows.length === 0
              ? emptyAtStart
              : nothingWaiting
                ? "An S0 Evaluation shows up here once its Technical in-charge gives the verdict."
                : "Nothing matches. Try another tab or search, or clear the filters."
          }
        />
      )}

      {!isLoading && !isError && visible.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <Table tableId="technical" className="md:min-w-[44rem]">
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  {COLUMNS.map(([heading, key]) => (
                    <SortHead
                      key={key}
                      id={`technical-${key}`}
                      sortKey={key}
                      sort={sort}
                      onSort={toggle}
                      className={`${HEAD} ${key === "state" ? STATE_HEAD_CLASS : ""} ${NARROW_HIDDEN.has(heading) ? "hidden md:table-cell" : ""}`}
                    >
                      {heading}
                    </SortHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {paging.rows.map((row) => (
                  <TechnicalRow key={row.opportunityId} row={row} selected={row.opportunityId === selectedId} onOpen={open} search={search} stageTones={stageTones} />
                ))}
              </TableBody>
            </Table>
          </div>
          <TablePager {...paging} noun="SORs" />
        </div>
      )}
    </PageShell>
  );
}
