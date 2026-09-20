import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Trash2, RotateCcw, AlertTriangle } from "lucide-react";
import Spinner from "../ui/Spinner";
import Avatar from "../Avatar";
import { opportunityService } from "../../services/opportunityService";
import { formatPHP } from "../../constants/sor";
import { confirmActionToast } from "../ui/CustomToast";

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
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-widest text-muted-foreground">
              <th className="px-3 py-2.5 text-left">Company</th>
              <th className="px-3 py-2.5 text-left">Project</th>
              <th className="px-3 py-2.5 text-right">Expected Value</th>
              <th className="px-3 py-2.5 text-left">Deleted By</th>
              <th className="px-3 py-2.5 text-left">Deleted At</th>
              <th className="px-3 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const canRestore = isSuperAdmin || row.deal_owner_id === currentUserId;
              return (
                <tr key={row.id} className="border-b border-border/50 last:border-0">
                  <td className="px-3 py-2.5 font-semibold">{row.client_name}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{row.project_title}</td>
                  <td className="px-3 py-2.5 text-right font-bold">{formatPHP(row.expected_value)}</td>
                  <td className="px-3 py-2.5">
                    {row.deleted_by_employee ? (
                      <span className="inline-flex items-center gap-1.5">
                        <Avatar name={row.deleted_by_employee.name} src={row.deleted_by_employee.avatar_path} size="xs" />
                        <span className="text-xs font-semibold">{row.deleted_by_employee.name}</span>
                      </span>
                    ) : (
                      <span className="text-xs italic text-muted-foreground/60">Unknown</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{formatWhen(row.deleted_at)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1.5">
                      {canRestore && (
                        <button
                          onClick={() => handleRestore(row)}
                          title="Restore"
                          className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <RotateCcw size={12} /> Restore
                        </button>
                      )}
                      {isSuperAdmin && (
                        <button
                          onClick={() => {
                            setPurgeTarget(row);
                            setConfirmText("");
                          }}
                          title="Permanently delete"
                          className="flex items-center gap-1 rounded-lg border border-red-500/30 px-2.5 py-1.5 text-xs font-bold text-red-600 transition-colors hover:bg-red-500/10 dark:text-red-400"
                        >
                          <Trash2 size={12} /> Delete forever
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
            <input
              autoFocus
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="mb-3 w-full rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm font-medium text-foreground outline-none focus:border-mauve-7"
            />
            {purgeMutation.isError && (
              <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-600 dark:text-red-400">
                {purgeMutation.error.message}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  setPurgeTarget(null);
                  setConfirmText("");
                }}
                className="h-10 rounded-xl px-3 text-[13px] font-bold text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                disabled={confirmText.trim() !== expectedConfirmText || purgeMutation.isPending}
                onClick={() => purgeMutation.mutate()}
                className="h-10 rounded-xl bg-red-600 px-4 text-[13px] font-bold text-white transition-all hover:bg-red-700 disabled:opacity-50"
              >
                Delete forever
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
