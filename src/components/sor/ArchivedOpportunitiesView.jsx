import { useMemo, useState } from "react";
import {
  SortHead,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTableSort } from "@/hooks/useTableSort";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Archive, ArchiveRestore, Search } from "lucide-react";
import HighlightText from "../HighlightText";
import { sorCodeOf, matchesSorSearch } from "../../utils/sorCode";
import Spinner from "../ui/Spinner";
import { opportunityService } from "../../services/opportunityService";
import { formatPHP } from "../../constants/sor";
import { Button } from "../ui/button";
import { Input } from "@/components/ui/input";

const formatWhen = (iso) =>
  iso ? new Date(iso).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : "";

const ARCHIVED_SORT = {
  number: (r) => sorCodeOf(r) || r.sales_reference,
  company: (r) => r.client_name,
  project: (r) => r.project_title,
  "deal-owner": (r) => r.deal_owner?.name,
  "expected-value": (r) => Number(r.expected_value),
  "archived-at": (r) => (r.archived_at ? new Date(r.archived_at).getTime() : null),
};

const openSor = (id) =>
  window.dispatchEvent(
    new CustomEvent("OPEN_ENTITY_DETAILS", { detail: { id, type: "OPPORTUNITY_QUICK_VIEW" } }),
  );

/**
 * Issue #1193 - the Archived tab: SORs put away from My work, the List and the Board. They still
 * count everywhere and still open; a Super Admin can un-archive. Nothing here is locked.
 */
export default function ArchivedOpportunitiesView({ isSuperAdmin }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const { data: unsortedRows = [], isLoading } = useQuery({
    queryKey: ["archivedOpportunities"],
    queryFn: () => opportunityService.getArchivedOpportunities(),
  });
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? unsortedRows.filter((o) => matchesSorSearch(o, q)) : unsortedRows;
  }, [unsortedRows, search]);
  const { sorted: rows, sort, toggle } = useTableSort(searched, ARCHIVED_SORT);

  const unarchive = useMutation({
    mutationFn: (id) => opportunityService.setArchived(id, false),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["archivedOpportunities"] });
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
      toast.success("SOR un-archived.");
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="mt-4 flex items-center justify-center gap-2 rounded-2xl border border-border bg-card py-16 text-muted-foreground">
        <Spinner size="sm" />
        <span className="text-sm font-bold uppercase tracking-widest">Loading Archived...</span>
      </div>
    );
  }

  if (unsortedRows.length === 0) {
    return (
      <div className="mt-4 rounded-2xl border border-border bg-card py-16 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <Archive size={18} />
        </div>
        <p className="text-sm font-bold text-foreground">Nothing archived</p>
      </div>
    );
  }

  return (
    <>
      <div className="mt-4 flex h-9 max-w-[360px] items-center gap-2 rounded-xl border border-border bg-muted/30 px-2.5 focus-within:border-mauve-7 sm:px-3">
        <Search size={15} className="shrink-0 text-muted-foreground" />
        <Input
          value={search}
          aria-label="Search register"
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search number, client, project, deal owner..."
          containerClassName="w-full"
          className="h-auto rounded-none border-0 bg-transparent px-0 py-0 text-sm font-medium text-foreground shadow-none outline-none placeholder:text-muted-foreground/50 focus-visible:ring-0"
        />
      </div>
      <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card">
        <div className="overflow-x-auto">
          <Table tableId="archived-opportunities">
            <TableHeader>
              <TableRow>
                <SortHead id="number" sortKey="number" sort={sort} onSort={toggle}>Number</SortHead>
                <SortHead id="company" sortKey="company" sort={sort} onSort={toggle}>Company</SortHead>
                <SortHead id="project" sortKey="project" sort={sort} onSort={toggle}>Project</SortHead>
                <SortHead id="deal-owner" sortKey="deal-owner" sort={sort} onSort={toggle}>Deal Owner</SortHead>
                <SortHead id="expected-value" sortKey="expected-value" sort={sort} onSort={toggle} className="text-right">Expected Value</SortHead>
                <SortHead id="archived-at" sortKey="archived-at" sort={sort} onSort={toggle}>Archived At</SortHead>
                <TableHead id="actions" className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                    No archived SOR matches this search.
                  </TableCell>
                </TableRow>
              )}
              {rows.map((row) => (
                <TableRow key={row.id} className="border-b border-border/50 last:border-0">
                  <TableCell className="font-mono text-xs">
                    <HighlightText text={sorCodeOf(row) || row.sales_reference} search={search} />
                  </TableCell>
                  <TableCell className="font-semibold">
                    <HighlightText text={row.client_name} search={search} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <HighlightText text={row.project_title} search={search} />
                  </TableCell>
                  <TableCell className="text-xs font-semibold">
                    <HighlightText text={row.deal_owner?.name} search={search} />
                  </TableCell>
                  <TableCell className="text-right font-bold">{formatPHP(row.expected_value)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatWhen(row.archived_at)}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1.5">
                      <Button type="button" variant="outline" size="sm" onClick={() => openSor(row.id)}>
                        Open
                      </Button>
                      {isSuperAdmin && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => unarchive.mutate(row.id)}
                          className="gap-1"
                        >
                          <ArchiveRestore size={12} /> Un-archive
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </>
  );
}
