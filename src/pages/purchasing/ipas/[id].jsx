import { useEffect, useState } from "react";
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
import EditValueDialog from "../../../components/ipas/EditValueDialog";
import PaymentDialog from "../../../components/ipas/PaymentDialog";
import ChargeDialog from "../../../components/ipas/ChargeDialog";
import BankDetailsDialog from "../../../components/ipas/BankDetailsDialog";
import { IpasBankDetails } from "../../../components/ipas/IpasBankDetails";
import {
  IpasChargesSection,
  IpasCostingSection,
  IpasPaymentsBlock,
} from "../../../components/ipas/IpasMoneySections";
import {
  IpasHeaderSection,
  IpasHistorySection,
  IpasPurchasingSection,
  IpasSalesSection,
  IpasStatusSection,
  IpasWarnings,
} from "../../../components/ipas/IpasSections";
import { ipasKey, ipasListKey, ipasRefreshKey } from "../../../components/ipas/ipasKeys";
import { ipasService } from "../../../services/ipasService";
import { useAuth } from "../../../context/AuthContext";
import { getPermissionContext } from "../../../utils/permissions";
import { ipasErrorMessage } from "../../../utils/ipas";
import { formatDate } from "../../../utils/formatDate.js";
import { IPAS_HEADER_FIELD, IPAS_OVERRIDE_FIELDS, IPAS_STATE } from "../../../constants/ipas";

const HEADER_LABELS = {
  [IPAS_HEADER_FIELD.SUPPLIER_CONTACT]: "Contact",
  [IPAS_HEADER_FIELD.PI_NUMBER]: "P.I #",
  [IPAS_HEADER_FIELD.PI_QT_AMOUNT]: "P.I/QT Amount",
};

/** The value a typed header field starts from in its dialog. */
function typingInitialValue(field, ipas) {
  switch (field) {
    case IPAS_HEADER_FIELD.SUPPLIER_CONTACT:
      return ipas.contact ?? "";
    case IPAS_HEADER_FIELD.PI_NUMBER:
      return ipas.piNumber ?? "";
    case IPAS_HEADER_FIELD.PI_QT_AMOUNT:
      return ipas.piQtAmount === null || ipas.piQtAmount === undefined ? "" : String(ipas.piQtAmount);
    default:
      return "";
  }
}

/**
 * One IPAS (issues #242 and #243, spec #241): the header, section 1 with the
 * item lines, section 2, and the Odoo-stamped statuses of section 6.
 *
 * Opening it refreshes the copy from Odoo beside the stored one, which paints
 * at once: a slow or silent Odoo never holds the page, and the last copy shows
 * with its fetch time. Purchasing overrides Entity, Source Doc. and Analytic
 * Dist. (Odoo's value stays beside the override, one action resets it), types
 * the contact and P.I # (Odoo fills them only while blank), changes Purpose and
 * SORs and cancels it, until it is filed. Every value read from Odoo carries
 * the Odoo mark.
 *
 * #244 adds the money: payments in section 1 and charges in section 3
 * (Purchasing or Finance), the typed P.I/QT Amount and the freight service,
 * and, in section 6, the computation status and Landed Cost with its
 * provisional or final mark.
 *
 * #245 adds bank details to section 3, with the changed-account flag beside the
 * Account #. Purchasing types them; Finance and the section 1 and 3 approvers
 * read them; anyone else the database refuses never sees the block.
 */
function IpasPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { hasPurchasingFlow, hasFinanceFlow } = getPermissionContext(user);

  const [editing, setEditing] = useState(false);
  const [paymentDialog, setPaymentDialog] = useState(null); // { payment | null }
  const [chargeDialog, setChargeDialog] = useState(null); // { charge | null }
  const [bankDialog, setBankDialog] = useState(false);
  const [removing, setRemoving] = useState(null); // { type: "payment" | "charge", row }
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [overriding, setOverriding] = useState(null);
  const [typing, setTyping] = useState(null);

  // The stored copy, at once. The refresh below catches it up.
  const { data: ipas, isLoading, isError, refetch } = useQuery({
    queryKey: ipasKey(id),
    queryFn: () => ipasService.get(id, { refresh: false }),
    enabled: Boolean(id),
  });

  // Opening an IPAS refreshes it from Odoo. It never fails the page: when Odoo
  // doesn't answer, the outcome says so and the last copy stays.
  const refresh = useQuery({
    queryKey: ipasRefreshKey(id),
    queryFn: () => ipasService.refresh(id),
    enabled: Boolean(id),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!refresh.dataUpdatedAt) return;
    queryClient.invalidateQueries({ queryKey: ipasKey(id) });
    queryClient.invalidateQueries({ queryKey: ipasListKey });
  }, [refresh.dataUpdatedAt, id, queryClient]);

  const changed = () => {
    queryClient.invalidateQueries({ queryKey: ipasKey(id) });
    queryClient.invalidateQueries({ queryKey: ipasListKey });
  };

  const override = useMutation({
    mutationFn: ({ field, value }) => ipasService.overrideField(id, field, value),
    onSuccess: (_, { field }) => {
      toast.success(`${IPAS_OVERRIDE_FIELDS[field].label} overridden. Odoo's value stays beside it.`);
      changed();
    },
    onError: (error) => toast.error(ipasErrorMessage(error)),
  });

  const reset = useMutation({
    mutationFn: (field) => ipasService.resetOverride(id, field),
    onSuccess: (_, field) => {
      toast.success(`${IPAS_OVERRIDE_FIELDS[field].label} is back to Odoo's value.`);
      changed();
    },
    onError: (error) => toast.error(ipasErrorMessage(error)),
  });

  const typeHeader = useMutation({
    mutationFn: ({ field, value }) =>
      ipasService.setHeader(id, {
        supplierContact: field === IPAS_HEADER_FIELD.SUPPLIER_CONTACT ? value : undefined,
        piNumber: field === IPAS_HEADER_FIELD.PI_NUMBER ? value : undefined,
        piQtAmount: field === IPAS_HEADER_FIELD.PI_QT_AMOUNT ? value : undefined,
      }),
    onSuccess: (_, { field }) => {
      toast.success(`${HEADER_LABELS[field]} saved.`);
      changed();
    },
    onError: (error) => toast.error(ipasErrorMessage(error)),
  });

  // Freight service, the computation status and how charges are spread: one
  // picked value each, kept in history with what it was.
  const pick = useMutation({
    mutationFn: (values) => ipasService.setHeader(id, values),
    onSuccess: () => changed(),
    onError: (error) => toast.error(ipasErrorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: ({ type, row }) =>
      type === "payment" ? ipasService.removePayment(row.id) : ipasService.removeCharge(row.id),
    onSuccess: (_, { type }) => {
      toast.success(type === "payment" ? "Payment removed." : "Charge removed.");
      setRemoving(null);
      changed();
    },
    onError: (error) => toast.error(ipasErrorMessage(error)),
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
  // Payments and charges: Purchasing or Finance, until Filing.
  const canRecord = (hasPurchasingFlow || hasFinanceFlow) && open;

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

          <IpasWarnings ipas={ipas} refresh={refresh.data} />

          <IpasHeaderSection
            ipas={ipas}
            canChange={canChange}
            onEditOverride={setOverriding}
            onResetOverride={(field) => reset.mutate(field)}
          />
          <IpasPurchasingSection
            ipas={ipas}
            refreshing={refresh.isFetching}
            canChange={canChange}
            onEditHeader={setTyping}
          >
            <IpasPaymentsBlock
              ipas={ipas}
              canChange={canChange}
              canRecord={canRecord}
              onEditAmount={() => setTyping(IPAS_HEADER_FIELD.PI_QT_AMOUNT)}
              onPickFreight={(optionId) => pick.mutate({ freightServiceId: optionId })}
              onAddPayment={() => setPaymentDialog({ payment: null })}
              onEditPayment={(payment) => setPaymentDialog({ payment })}
              onRemovePayment={(payment) => setRemoving({ type: "payment", row: payment })}
            />
          </IpasPurchasingSection>
          <IpasSalesSection
            ipas={ipas}
            canChange={canChange}
            onEditOverride={setOverriding}
            onResetOverride={(field) => reset.mutate(field)}
          />
          <IpasChargesSection
            ipas={ipas}
            canRecord={canRecord}
            onAddCharge={() => setChargeDialog({ charge: null })}
            onEditCharge={(charge) => setChargeDialog({ charge })}
            onRemoveCharge={(charge) => setRemoving({ type: "charge", row: charge })}
          >
            <IpasBankDetails ipas={ipas} canChange={canChange} onEdit={() => setBankDialog(true)} />
          </IpasChargesSection>
          <IpasStatusSection ipas={ipas} />
          <IpasCostingSection
            ipas={ipas}
            canChange={canChange}
            onSetStatus={(computationStatus) => pick.mutate({ computationStatus })}
            onSetSplit={(landedCostSplit) => pick.mutate({ landedCostSplit })}
          />
          <IpasHistorySection events={ipas.events} />
        </div>
      </PageShell>

      <EditPurposeSorsDialog ipas={ipas} open={editing} onOpenChange={setEditing} />

      <PaymentDialog
        open={paymentDialog !== null}
        onOpenChange={(next) => !next && setPaymentDialog(null)}
        ipas={ipas}
        payment={paymentDialog?.payment ?? null}
      />

      <ChargeDialog
        open={chargeDialog !== null}
        onOpenChange={(next) => !next && setChargeDialog(null)}
        ipas={ipas}
        charge={chargeDialog?.charge ?? null}
      />

      <BankDetailsDialog open={bankDialog} onOpenChange={setBankDialog} ipas={ipas} />

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(next) => !next && setRemoving(null)}
        title={removing?.type === "payment" ? "Remove this payment?" : "Remove this charge?"}
        description="It leaves the IPAS and Landed Cost is worked out again. The history keeps what was removed."
        confirmLabel="Remove"
        cancelLabel="Keep it"
        tone="destructive"
        onConfirm={() => removing && remove.mutate(removing)}
      />

      <EditValueDialog
        open={overriding !== null}
        onOpenChange={(open) => !open && setOverriding(null)}
        title={`Override ${IPAS_OVERRIDE_FIELDS[overriding]?.label ?? ""}`}
        description="Your value is kept through every refresh from Odoo. Reset it any time to go back to Odoo's."
        label={IPAS_OVERRIDE_FIELDS[overriding]?.label ?? ""}
        initialValue={overriding ? (ipas.overrides[overriding].value ?? "") : ""}
        odooValue={overriding ? (ipas.overrides[overriding].odoo ?? "blank") : null}
        submitLabel="Override"
        onSubmit={(value) => override.mutateAsync({ field: overriding, value })}
      />

      <EditValueDialog
        open={typing !== null}
        onOpenChange={(open) => !open && setTyping(null)}
        title={`Edit ${HEADER_LABELS[typing] ?? ""}`}
        description="What you type is kept; Odoo fills this only while it is blank."
        label={HEADER_LABELS[typing] ?? ""}
        initialValue={typingInitialValue(typing, ipas)}
        allowBlank
        onSubmit={(value) => typeHeader.mutateAsync({ field: typing, value })}
      />

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
