import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Trash2, RotateCcw, AlertTriangle } from "lucide-react";
import Spinner from "../ui/Spinner";
import Avatar from "../Avatar";
import { opportunityService } from "../../services/opportunityService";
import { formatPHP } from "../../constants/sor";
import { confirmActionToast } from "../ui/CustomToast";
import { Button } from "@/components/ui/button";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Input } from "@/components/ui/input";

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
export default function DeletedOpportunitiesView({ currentUserId, isSuperAdmin }) {
  const queryClient = useQueryClient();
  const [purgeTarget, setPurgeTarget] = useState(null);
  const [confirmText, setConfirmText] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["deletedOpportunities", currentUserId, isSuperAdmin],
    queryFn: () => opportunityService.getDeletedOpportunities(currentUserId, { isSuperAdmin }),
    enabled: Boolean(currentUserId),
  });

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
      `${row.client_name} — ${row.project_title} moves back into the live register. This doesn't reopen any procurement requests its delete cancelled; re-raise what's still needed.`,
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

  if (rows.length === 0) {
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
    <div className="mt-4 overflow-hidden rounded-2xl border border-border bg-card">
      <div className="overflow-x-auto">
        <Table >
          <TableHeader>
            <TableRow >
              <TableHead >Company</TableHead>
              <TableHead >Project</TableHead>
              <TableHead className="text-right">Expected Value</TableHead>
              <TableHead >Deleted By</TableHead>
              <TableHead >Deleted At</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const canRestore = isSuperAdmin || row.deal_owner_id === currentUserId;
              return (
                <TableRow key={row.id} >
                  <TableCell >{row.client_name}</TableCell>
                  <TableCell >{row.project_title}</TableCell>
                  <TableCell className="text-right">{formatPHP(row.expected_value)}</TableCell>
                  <TableCell >
                    {row.deleted_by_employee ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Avatar name={row.deleted_by_employee.name} src={row.deleted_by_employee.avatar_path} size="xs" />
                        <span className="text-xs font-semibold">{row.deleted_by_employee.name}</span>
                      </span>
                    ) : (
                      <span className="text-xs italic text-muted-foreground/60">Unknown</span>
                    )}
                  </TableCell>
                  <TableCell >{formatWhen(row.deleted_at)}</TableCell>
                  <TableCell >
                    <div className="flex items-center justify-end gap-1.5">
                      {canRestore && (
                        <Button
                          onClick={() => handleRestore(row)}
                          title="Restore"
                          variant="outline"
                        >
                          <RotateCcw size={12} /> Restore
                        </Button>
                      )}
                      {isSuperAdmin && (
                        <Button
                          onClick={() => {
                            setPurgeTarget(row);
                            setConfirmText("");
                          }}
                          title="Permanently delete"
                          variant="ghost"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-xl">
            <p className="mb-1 flex items-center gap-1.5 text-sm font-bold text-red-600 dark:text-red-400">
              <AlertTriangle size={15} /> Permanently delete this SOR?
            </p>
            <p className="mb-3 text-xs text-muted-foreground">
              {purgeTarget.client_name} — {purgeTarget.project_title}. This cannot be undone. Its
              tasks are kept, unlinked — only the SOR itself and its own records are removed.
            </p>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Type <span className="font-mono text-foreground">{expectedConfirmText}</span> to confirm
            </label>
            <Input
              autoFocus
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              containerClassName="mb-3 w-full"
            />
            {purgeMutation.isError && (
              <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-600 dark:text-red-400">
                {purgeMutation.error.message}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button
                onClick={() => {
                  setPurgeTarget(null);
                  setConfirmText("");
                }}
                variant="ghost" className="h-auto"
              >
                Cancel
              </Button>
              <Button
                disabled={confirmText.trim() !== expectedConfirmText || purgeMutation.isPending}
                onClick={() => purgeMutation.mutate()}
                variant="ghost" className="h-auto"
              >
                Delete forever
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
