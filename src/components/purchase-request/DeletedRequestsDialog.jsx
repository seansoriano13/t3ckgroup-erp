import { useQuery } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";

import ModalShell from "@/components/ui/ModalShell";
import Spinner from "@/components/ui/Spinner";
import QueryError from "@/components/ui/QueryError";
import { Button } from "@/components/ui/button";
import { purchaseRequestService } from "@/services/purchaseRequestService";
import { listDate } from "@/utils/listDates";
import { deletedRequestsKey } from "./queryKeys";
import { useRestoreRequest } from "./requestHooks";

/**
 * The Deleted view (Purchasing and Super Admin): every deleted Purchase Request
 * as a one-line liner with who deleted it, when and why, and a Restore button.
 * A restored request goes back to the queue as it was; its PR number never changed.
 */
export default function DeletedRequestsDialog({ open, onOpenChange }) {
  const { data: rows = [], isLoading, isError, refetch } = useQuery({
    queryKey: deletedRequestsKey,
    queryFn: () => purchaseRequestService.listDeleted(),
    enabled: open,
  });
  const restore = useRestoreRequest();

  return (
    <ModalShell open={open} onOpenChange={onOpenChange} crumbs={["Purchase Requests", "Deleted"]} title="Deleted requests" size="record">
      {isLoading && (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      )}
      {isError && <QueryError title="Deleted requests could not be loaded." onRetry={refetch} />}
      {!isLoading && !isError && rows.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No deleted requests.</p>}
      {rows.length > 0 && (
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {[row.pr_number, row.title || row.sales_reference].filter(Boolean).join(" · ")}
                </p>
                <p className="text-xs text-muted-foreground">
                  Deleted by {row.deleted_by_name || "someone"} on {listDate(row.deleted_at)} · {row.delete_reason}
                </p>
              </div>
              <Button size="sm" variant="outline" disabled={restore.isPending} onClick={() => restore.mutate(row.id)} className="gap-1.5">
                <RotateCcw size={14} />
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
    </ModalShell>
  );
}
