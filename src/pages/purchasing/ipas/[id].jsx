import { useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowLeft, Ban, Pencil, ReceiptText } from "lucide-react";

import ProtectedRoute from "../../../components/ProtectedRoute";
import PageShell from "../../../components/ui/PageShell";
import PageLoading from "../../../components/ui/PageLoading";
import EmptyState from "../../../components/ui/EmptyState";
import QueryError from "../../../components/ui/QueryError";
import ConfirmDialog from "../../../components/ui/ConfirmDialog";
import { Button } from "../../../components/ui/button";
import { Textarea } from "../../../components/ui/textarea";
import { FieldBox } from "../../../components/ui/FieldBox";
import IpasStateBadge from "../../../components/ipas/IpasStateBadge";
import EditPurposeSorsDialog from "../../../components/ipas/EditPurposeSorsDialog";
import {
  IpasHeaderSection,
  IpasHistorySection,
  IpasPurchasingSection,
  IpasSalesSection,
} from "../../../components/ipas/IpasSections";
import { ipasKey, ipasListKey } from "../../../components/ipas/ipasKeys";
import { ipasService } from "../../../services/ipasService";
import { useAuth } from "../../../context/AuthContext";
import { getPermissionContext } from "../../../utils/permissions";
import { ipasErrorMessage } from "../../../utils/ipas";
import { formatDate } from "../../../utils/formatDate.js";
import { IPAS_STATE } from "../../../constants/ipas";

/**
 * One IPAS (issue #242, spec #241): the header, section 1 with the item lines
 * as Odoo had them when last fetched, and section 2. Purchasing changes the
 * Purpose and SORs and cancels it, until it is filed. Every value read from
 * Odoo carries the Odoo mark and the copy's fetch time.
 */
function IpasPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { hasPurchasingFlow } = getPermissionContext(user);

  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");

  const { data: ipas, isLoading, isError, refetch } = useQuery({
    queryKey: ipasKey(id),
    queryFn: () => ipasService.get(id),
    enabled: Boolean(id),
  });

  const cancel = useMutation({
    mutationFn: () => ipasService.cancel(id, reason),
    onSuccess: () => {
      toast.success(`${ipas.number} cancelled. The number is kept.`);
      setReason("");
      queryClient.invalidateQueries({ queryKey: ipasKey(id) });
      queryClient.invalidateQueries({ queryKey: ipasListKey });
    },
    onError: (error) => toast.error(ipasErrorMessage(error)),
  });

  const back = (
    <Link
      to="/purchasing/ipas"
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-mauve-3 hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      IPAS
    </Link>
  );

  if (isLoading) return <PageLoading />;

  if (isError) {
    return (
      <PageShell title="IPAS" action={back}>
        <QueryError title="This IPAS could not be loaded." onRetry={refetch} />
      </PageShell>
    );
  }

  if (!ipas) {
    return (
      <PageShell title="IPAS" action={back}>
        <EmptyState
          icon={ReceiptText}
          title="IPAS not found"
          description="It doesn't exist, or you don't have access to it."
        />
      </PageShell>
    );
  }

  const open = ipas.state === IPAS_STATE.OPEN;
  const cancelled = ipas.state === IPAS_STATE.CANCELLED;
  const canChange = hasPurchasingFlow && open;

  return (
    <>
      <PageShell
        title={ipas.number}
        description={[ipas.po_number, ipas.supplier].filter(Boolean).join(" · ")}
        action={
          <>
            <IpasStateBadge state={ipas.state} />
            {canChange && (
              <>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setEditing(true)}>
                  <Pencil size={14} />
                  Purpose and SORs
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setCancelling(true)}>
                  <Ban size={14} />
                  Cancel IPAS
                </Button>
              </>
            )}
            {back}
          </>
        }
      >
        <div className="space-y-4">
          {cancelled && (
            <div role="status" className="rounded-xl border border-border bg-muted/40 p-3 text-[13px]">
              <p className="font-semibold text-foreground">
                Cancelled {formatDate(ipas.cancelled_at)}
                {ipas.canceller?.name ? ` by ${ipas.canceller.name}` : ""}
              </p>
              <p className="mt-0.5 text-muted-foreground">{ipas.cancel_reason}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                The number {ipas.number} is kept and won&apos;t be used again. {ipas.po_number} can be raised afresh.
              </p>
            </div>
          )}

          <IpasHeaderSection ipas={ipas} />
          <IpasPurchasingSection ipas={ipas} />
          <IpasSalesSection ipas={ipas} />
          <IpasHistorySection events={ipas.events} />
        </div>
      </PageShell>

      <EditPurposeSorsDialog ipas={ipas} open={editing} onOpenChange={setEditing} />

      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={`Cancel ${ipas.number}?`}
        description={`It stays readable and keeps its number. ${ipas.po_number} can then be raised on a new IPAS.`}
        confirmLabel="Cancel IPAS"
        cancelLabel="Keep it"
        tone="destructive"
        confirmDisabled={reason.trim() === ""}
        onConfirm={() => cancel.mutate()}
      >
        <FieldBox label="Reason" bare>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Why is this IPAS being cancelled?"
          />
        </FieldBox>
      </ConfirmDialog>
    </>
  );
}

// Every employee reaches the route; the database decides what comes back
// (ipas_can_read), so a non-reader gets the "not found" state.
export default function IpasPageRoute() {
  return (
    <ProtectedRoute>
      <IpasPage />
    </ProtectedRoute>
  );
}
