import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Trash2, RotateCcw, AlertTriangle } from "lucide-react";
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
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Project</TableHead>
              <TableHead className="text-right">Expected Value</TableHead>
              <TableHead>Deleted By</TableHead>
              <TableHead>Deleted At</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const canRestore = isSuperAdmin || row.deal_owner_id === currentUserId;
              return (
                <TableRow key={row.id} className="border-b border-border/50 last:border-0">
                  <TableCell className="font-semibold">{row.client_name}</TableCell>
                  <TableCell className="text-muted-foreground">{row.project_title}</TableCell>
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
  );
}
