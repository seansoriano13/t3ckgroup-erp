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
import { Trash2, RotateCcw, AlertTriangle, Search } from "lucide-react";
import HighlightText from "../HighlightText";
import { sorCodeOf, matchesSorSearch } from "../../utils/sorCode";
import Spinner from "../ui/Spinner";
import Avatar from "../Avatar";
import { opportunityService } from "../../services/opportunityService";
import { formatPHP } from "../../constants/sor";
import { confirmActionToast } from "../ui/CustomToast";
import { Button } from "../ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { FieldBox } from "@/components/ui/FieldBox";

function formatWhen(iso) {
  if (!iso) return "Deleted before this was recorded";
  return new Date(iso).toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Issue #206 — the Deleted view: who deleted what, when, with a restore for
 * a Super Admin or the SOR's own Deal Owner, and a guarded permanent delete
 * for a Super Admin only. Nothing here is purged on a timer — a row stays
 * until someone explicitly destroys it.
 */
const DELETED_SORT = {
  number: (r) => sorCodeOf(r) || r.sales_reference,
  company: (r) => r.client_name,
  project: (r) => r.project_title,
  "deal-owner": (r) => r.deal_owner?.name,
  "expected-value": (r) => Number(r.expected_value),
  "deleted-by": (r) => r.deleted_by_employee?.name,
  "deleted-at": (r) => (r.deleted_at ? new Date(r.deleted_at).getTime() : null),
};

export default function DeletedOpportunitiesView({ currentUserId, isSuperAdmin }) {
  const queryClient = useQueryClient();
  const [purgeTarget, setPurgeTarget] = useState(null);
  const [confirmText, setConfirmText] = useState("");

  const { data: unsortedRows = [], isLoading } = useQuery({
    queryKey: ["deletedOpportunities", currentUserId, isSuperAdmin],
    queryFn: () => opportunityService.getDeletedOpportunities(currentUserId, { isSuperAdmin }),
    enabled: Boolean(currentUserId),
  });
  const [search, setSearch] = useState("");
  // Same fields as the main register's search box.
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return unsortedRows;
    return unsortedRows.filter((o) => matchesSorSearch(o, q));
  }, [unsortedRows, search]);
  const { sorted: rows, sort, toggle } = useTableSort(searched, DELETED_SORT);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["deletedOpportunities"] });
    queryClient.invalidateQueries({ queryKey: ["opportunities"] });
  };

  const restoreMutation = useMutation({
    mutationFn: (id) => opportunityService.restoreOpportunity(id, currentUserId),
    onSuccess: () => {
      invalidate();
      toast.success("SOR restored.");
    },
    onError: (err) => toast.error(err.message),
  });

  const purgeMutation = useMutation({
    mutationFn: () => opportunityService.purgeOpportunity(purgeTarget.id, confirmText.trim(), currentUserId),
    onSuccess: () => {
      invalidate();
      toast.success("SOR permanently deleted.");
      setPurgeTarget(null);
      setConfirmText("");
    },
    onError: (err) => toast.error(err.message),
  });

  const handleRestore = (row) => {
    confirmActionToast(
      "Restore this SOR?",
      `${row.client_name} — ${row.project_title} moves back into the live register. Its Purchase Request, if it has one, carries on where it stopped.`,
      "Restore",
      "warning",
      () => restoreMutation.mutate(row.id),
    );
  };

  const expectedConfirmText = purgeTarget?.sales_reference || purgeTarget?.client_name || "";

  if (isLoading) {
    return (
      <div className="mt-4 flex items-center justify-center gap-2 rounded-2xl border border-border bg-card py-16 text-muted-foreground">
        <Spinner size="sm" />
        <span className="text-sm font-bold uppercase tracking-widest">Loading Deleted…</span>
      </div>
    );
  }

  if (unsortedRows.length === 0) {
    return (
      <div className="mt-4 rounded-2xl border border-border bg-card py-16 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <Trash2 size={18} />
        </div>
        <p className="text-sm font-bold text-foreground">Nothing deleted</p>
        <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
          {isSuperAdmin
            ? "No SOR has been deleted."
            : "None of your SORs have been deleted."}
        </p>
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
        placeholder="Search number, client, project, deal owner…"
        containerClassName="w-full"
        className="h-auto rounded-none border-0 bg-transparent px-0 py-0 text-sm font-medium text-foreground shadow-none outline-none placeholder:text-muted-foreground/50 focus-visible:ring-0"
      />
    </div>
    <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card">
      <div className="overflow-x-auto">
        <Table tableId="deleted-opportunities">
          <TableHeader>
            <TableRow>
              <SortHead id="number" sortKey="number" sort={sort} onSort={toggle}>Number</SortHead>
              <SortHead id="company" sortKey="company" sort={sort} onSort={toggle}>Company</SortHead>
              <SortHead id="project" sortKey="project" sort={sort} onSort={toggle}>Project</SortHead>
              <SortHead id="deal-owner" sortKey="deal-owner" sort={sort} onSort={toggle}>Deal Owner</SortHead>
              <SortHead id="expected-value" sortKey="expected-value" sort={sort} onSort={toggle} className="text-right">Expected Value</SortHead>
              <SortHead id="deleted-by" sortKey="deleted-by" sort={sort} onSort={toggle}>Deleted By</SortHead>
              <SortHead id="deleted-at" sortKey="deleted-at" sort={sort} onSort={toggle}>Deleted At</SortHead>
              <TableHead id="actions" className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                  No deleted SOR matches this search.
                </TableCell>
              </TableRow>
            )}
            {rows.map((row) => {
              const canRestore = isSuperAdmin || row.deal_owner_id === currentUserId;
              return (
                <TableRow key={row.id} className="border-b border-border/50 last:border-0">
                  <TableCell className="font-mono text-xs">
                    <HighlightText text={sorCodeOf(row) || row.sales_reference} search={search} />
                    {sorCodeOf(row) && row.sales_reference ? (
                      <div className="font-sans text-[11px] text-muted-foreground"><HighlightText text={row.sales_reference} search={search} /></div>
                    ) : null}
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
                  <TableCell>
                    {row.deleted_by_employee ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Avatar name={row.deleted_by_employee.name} src={row.deleted_by_employee.avatar_path} size="xs" />
                        <span className="text-xs font-semibold">{row.deleted_by_employee.name}</span>
                      </span>
                    ) : (
                      <span className="text-xs italic text-muted-foreground/60">Unknown</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatWhen(row.deleted_at)}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1.5">
                      {canRestore && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleRestore(row)}
                          title="Restore"
                          className="gap-1"
                        >
                          <RotateCcw size={12} /> Restore
                        </Button>
                      )}
                      {isSuperAdmin && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setPurgeTarget(row);
                            setConfirmText("");
                          }}
                          title="Permanently delete"
                          className="gap-1 border border-red-500/30 text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400 dark:hover:text-red-400"
                        >
                          <Trash2 size={12} /> Delete forever
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {purgeTarget && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (open) return;
            setPurgeTarget(null);
            setConfirmText("");
          }}
        >
          <DialogContent showCloseButton={false} className="max-w-md sm:max-w-md p-5 gap-0">
            <p className="mb-1 flex items-center gap-1.5 text-sm font-bold text-red-600 dark:text-red-400">
              <AlertTriangle size={15} /> Permanently delete this SOR?
            </p>
            <p className="mb-3 text-xs text-muted-foreground">
              {purgeTarget.client_name} — {purgeTarget.project_title}. This cannot be undone. Its
              tasks are kept, unlinked — only the SOR itself and its own records are removed.
            </p>
            <FieldBox label={<>Type <span className="font-mono text-foreground">{expectedConfirmText}</span> to confirm</>} className="mb-1 block" />
            <Input
              autoFocus
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              containerClassName="mb-3 w-full" className="font-medium"
            />
            {purgeMutation.isError && (
              <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-600 dark:text-red-400">
                {purgeMutation.error.message}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setPurgeTarget(null);
                  setConfirmText("");
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={confirmText.trim() !== expectedConfirmText || purgeMutation.isPending}
                onClick={() => purgeMutation.mutate()}
                className="bg-red-600 text-white hover:bg-red-700 hover:text-white"
              >
                Delete forever
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
    </>
  );
}
