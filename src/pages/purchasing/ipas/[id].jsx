import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowLeft, Ban, FileLock2, Pencil, Printer, ReceiptText } from "lucide-react";

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
import DocumentDialog from "../../../components/ipas/DocumentDialog";
import DatesDialog from "../../../components/ipas/DatesDialog";
import { IpasDocuments } from "../../../components/ipas/IpasDocuments";
import { IpasSignoffs } from "../../../components/ipas/IpasSignoffs";
import SendBackDialog from "../../../components/ipas/SendBackDialog";
import FilingDialog from "../../../components/ipas/FilingDialog";
import { IpasFiledNotice, IpasFilingSection } from "../../../components/ipas/IpasFiling";
import { IpasLogisticsSection } from "../../../components/ipas/IpasLogistics";
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
import {
  ipasKey,
  ipasListKey,
  ipasPendingPrefix,
  ipasRefreshKey,
  ipasSignerListsKey,
} from "../../../components/ipas/ipasKeys";
import { ipasService } from "../../../services/ipasService";
import { openPrintWindow, printIpas } from "../../../lib/pdf/ipasPrinter";
import { useAuth } from "../../../context/AuthContext";
import { getPermissionContext } from "../../../utils/permissions";
import { ipasErrorMessage } from "../../../utils/ipas";
import { isCostsComplete, section7Rights, signoffRights } from "../../../utils/ipasSignoffs";
import { formatDate } from "../../../utils/formatDate.js";
import {
  IPAS_HEADER_FIELD,
  IPAS_OVERRIDE_FIELDS,
  IPAS_SIGNOFF_ROLE,
  IPAS_SIGNOFF_ROLE_LABELS,
  IPAS_STATE,
  IPAS_SUPPLIER_ORIGIN_FIELDS,
  IPAS_TYPED_STATUS,
  IPAS_TYPED_STATUS_LABELS,
} from "../../../constants/ipas";

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
 *
 * #246 adds the documents (section 3: two ticks per row, Purchasing's and
 * Finance's own), the typed Item Location (section 5) and, in section 6,
 * Supplier Origin (Import only) and the buyer track with the source of each
 * status.
 *
 * #247 adds the sign-offs of sections 1 and 3 at the foot of each: Prepared
 * (Purchasing access), Approved (the section's list, never the preparer) and
 * Send back with a reason (the section's list). Each person is offered only
 * what the database will let them do; it refuses the rest.
 *
 * #248 adds section 7 (Received, Noted and Checked, then Approved, which files
 * the IPAS after a confirmation that lists the required documents nobody has
 * ticked) and the filed state: a banner, every edit control gone, and a Super
 * Admin's Reopen with a reason.
 */
function IpasPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { hasPurchasingFlow, hasFinanceFlow, isSuperAdmin } = getPermissionContext(user);
  const [sendingBack, setSendingBack] = useState(null); // the section being sent back
  const [filing, setFiling] = useState(false); // the Approve (files the IPAS) dialog
  const [reopening, setReopening] = useState(false);

  const [editing, setEditing] = useState(false);
  const [paymentDialog, setPaymentDialog] = useState(null); // { payment | null }
  const [chargeDialog, setChargeDialog] = useState(null); // { charge | null }
  const [bankDialog, setBankDialog] = useState(false);
  const [removing, setRemoving] = useState(null); // { type: "payment" | "charge", row }
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [overriding, setOverriding] = useState(null);
  const [typing, setTyping] = useState(null);
  const [documentDialog, setDocumentDialog] = useState(false);
  const [removingDocument, setRemovingDocument] = useState(null);
  // The typed dates being edited: "origin" (Supplier Origin) or a typed status key.
  const [dates, setDates] = useState(null);

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

  // Who is on each sign-off list, so the page offers Approve and Send back only
  // to people on one. It never fails the page: no lists reads as nobody.
  const { data: signerLists } = useQuery({
    queryKey: ipasSignerListsKey,
    queryFn: () => ipasService.getSignerLists(),
    enabled: Boolean(id),
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

  // A sign-off moves the Approval Center queue and its badge too.
  const signoffChanged = () => {
    changed();
    queryClient.invalidateQueries({ queryKey: ipasPendingPrefix });
  };

  const signoff = useMutation({
    mutationFn: ({ section, role }) => ipasService.sign(id, section, role),
    onSuccess: ({ notified }, { section, role }) => {
      if (role === IPAS_SIGNOFF_ROLE.PREPARED) {
        toast.success(
          notified > 0
            ? `Section ${section} prepared. The approvers were told.`
            : `Section ${section} prepared. Nobody is on its approval list yet.`,
        );
      } else {
        toast.success(`Section ${section} approved.`);
      }
      signoffChanged();
    },
    onError: (error) => toast.error(ipasErrorMessage(error)),
  });

  // Section 7's steps. Approved files the IPAS and goes through the dialog that
  // lists the required documents nobody has ticked; `confirm` is the user's yes.
  const give = useMutation({
    mutationFn: ({ role, confirm }) => ipasService.sign(id, 7, role, { confirm }),
    onSuccess: (result, { role }) => {
      if (result.filed) toast.success(`${ipas.number} is filed.`);
      else toast.success(`Section 7 ${IPAS_SIGNOFF_ROLE_LABELS[role].toLowerCase()}.`);
      signoffChanged();
    },
    onError: (error) => toast.error(ipasErrorMessage(error)),
  });

  const reopen = useMutation({
    mutationFn: (reason) => ipasService.reopen(id, reason),
    onSuccess: () => {
      toast.success(`${ipas.number} is open again. Section 7's sign-offs were cleared.`);
      signoffChanged();
    },
    onError: (error) => toast.error(ipasErrorMessage(error)),
  });

  const sendBack = useMutation({
    mutationFn: ({ section, reason }) => ipasService.sendBack(id, section, reason),
    onSuccess: (_, { section }) => {
      toast.success(`Section ${section} sent back to its preparer.`);
      signoffChanged();
    },
    onError: (error) => toast.error(ipasErrorMessage(error)),
  });

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

  // Documents (#246). Each tick is its own department's: the database refuses
  // the other's, and the page only offers each person their own box.
  const tick = useMutation({
    mutationFn: ({ document, side, value }) => ipasService.tickDocument(document.id, side, value),
    onSuccess: changed,
    onError: (error) => toast.error(ipasErrorMessage(error)),
  });

  const attach = useMutation({
    mutationFn: ({ document, url }) => ipasService.setDocument(document.id, { attachmentUrl: url }),
    onSuccess: (_, { url }) => {
      toast.success(url ? "File attached." : "Attachment removed.");
      changed();
    },
    onError: (error) => toast.error(ipasErrorMessage(error)),
  });

  const suggest = useMutation({
    mutationFn: () => ipasService.suggestDocuments(id),
    onSuccess: (added) => {
      toast.success(added.length === 1 ? `${added[0]} added.` : `${added.length} documents added.`);
      changed();
    },
    onError: (error) => toast.error(ipasErrorMessage(error)),
  });

  const removeDocument = useMutation({
    mutationFn: (document) => ipasService.removeDocument(document.id),
    onSuccess: () => {
      toast.success("Document removed.");
      setRemovingDocument(null);
      changed();
    },
    onError: (error) => {
      toast.error(ipasErrorMessage(error));
      setRemovingDocument(null);
    },
  });

  // Supplier Origin, the typed statuses, Actual Checking and Item Location.
  const saveDates = useMutation({
    mutationFn: (values) =>
      dates === "origin"
        ? ipasService.setSupplierOrigin(id, values)
        : ipasService.setTypedStatus(id, dates, Object.values(values)[0] ?? ""),
    onSuccess: () => {
      toast.success(dates === "origin" ? "Supplier Origin saved." : `${IPAS_TYPED_STATUS_LABELS[dates]} saved.`);
      changed();
    },
    onError: (error) => toast.error(ipasErrorMessage(error)),
  });

  const stamp = useMutation({
    mutationFn: (stamped) => ipasService.stampActualChecking(id, { stamped }),
    onSuccess: (_, stamped) => {
      toast.success(stamped ? "Actual Checking stamped." : "Actual Checking stamp cleared.");
      changed();
    },
    onError: (error) => toast.error(ipasErrorMessage(error)),
  });

  const locate = useMutation({
    mutationFn: (optionId) => ipasService.setItemLocation(id, optionId),
    onSuccess: changed,
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

  // Printing (#250): two A4 pages through the browser's print dialog. The window
  // opens in the click (a popup blocker allows it there); the refresh from Odoo,
  // unless filed, and the signatures are fetched while it says "Preparing".
  const print = useMutation({
    mutationFn: ({ filingCopy, printWindow }) =>
      printIpas(id, { printWindow, filingCopy, printedBy: user?.name ?? null }),
    onError: (error) => toast.error(error?.message || "The IPAS couldn't be printed."),
  });
  const startPrint = (filingCopy) => {
    const printWindow = openPrintWindow();
    if (!printWindow) {
      toast.error("Popup blocked. Allow popups for this site to print.");
      return;
    }
    print.mutate({ filingCopy, printWindow });
  };

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
  const filed = ipas.state === IPAS_STATE.FILED;
  const canChange = hasPurchasingFlow && open;
  // Payments and charges: Purchasing or Finance, until Filing.
  const canRecord = (hasPurchasingFlow || hasFinanceFlow) && open;
  // Finance has it: Finance access alone ticks it, until Filing.
  const canTickFinance = hasFinanceFlow && open;

  // The sign-offs of sections 1 and 3: what this person may do on each.
  const signoffBlock = (section) => (
    <IpasSignoffs
      section={section}
      state={ipas.signoffSections[section]}
      rights={signoffRights({
        section,
        sectionState: ipas.signoffSections[section],
        userId: user?.id,
        hasPurchasingFlow,
        lists: signerLists,
        ipasState: ipas.state,
      })}
      busy={signoff.isPending || sendBack.isPending}
      onPrepare={() => signoff.mutate({ section, role: IPAS_SIGNOFF_ROLE.PREPARED })}
      onApprove={() => signoff.mutate({ section, role: IPAS_SIGNOFF_ROLE.APPROVED })}
      onSendBack={() => setSendingBack(section)}
    />
  );

  // Section 7: what this person may give, from where it stands.
  const filingRights = section7Rights({
    state: ipas.signoffSections[7],
    userId: user?.id,
    lists: signerLists,
    ipasState: ipas.state,
    costsComplete: isCostsComplete(ipas.computationStatus),
  });
  const giveSignoff = (role) => {
    if (role === IPAS_SIGNOFF_ROLE.APPROVED) setFiling(true);
    else give.mutate({ role, confirm: false });
  };

  // What the dates dialog edits: the four Supplier Origin dates, or one typed status.
  const dateFields =
    dates === "origin"
      ? IPAS_SUPPLIER_ORIGIN_FIELDS.map(({ field, column, label }) => ({
          key: field,
          label,
          value: ipas.supplierOrigin?.[field] ?? ipas[column] ?? "",
        }))
      : dates
        ? [
            {
              key: dates,
              label: IPAS_TYPED_STATUS_LABELS[dates],
              value: (dates === IPAS_TYPED_STATUS.IMPORT_CLEARANCE ? ipas.import_clearance_on : ipas.delivered_on) ?? "",
            },
          ]
        : [];

  return (
    <>
      <PageShell
        title={ipas.number}
        description={[ipas.po_number, ipas.supplier].filter(Boolean).join(" · ")}
        action={
          <>
            <IpasStateBadge state={ipas.state} />
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={print.isPending}
              onClick={() => startPrint(false)}
            >
              <Printer size={14} />
              {print.isPending ? "Preparing…" : "Print"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={print.isPending}
              onClick={() => startPrint(true)}
            >
              <FileLock2 size={14} />
              Print filing copy
            </Button>
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

          <IpasFiledNotice ipas={ipas} canReopen={isSuperAdmin && filed} onReopen={() => setReopening(true)} />

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
            {signoffBlock(1)}
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
            <IpasDocuments
              ipas={ipas}
              canChange={canChange}
              canTickFinance={canTickFinance}
              onTick={(document, side, value) => tick.mutate({ document, side, value })}
              onAttach={(document, url) => attach.mutateAsync({ document, url })}
              onRemoveAttachment={(document) => attach.mutate({ document, url: "" })}
              onAdd={() => setDocumentDialog(true)}
              onSuggest={() => suggest.mutate()}
              onRemove={setRemovingDocument}
            />
            <IpasBankDetails ipas={ipas} canChange={canChange} onEdit={() => setBankDialog(true)} />
            {signoffBlock(3)}
          </IpasChargesSection>
          <IpasLogisticsSection ipas={ipas} canChange={canChange} onPick={(optionId) => locate.mutate(optionId)} />
          <IpasStatusSection
            ipas={ipas}
            canChange={canChange}
            onEditOrigin={() => setDates("origin")}
            onEditStatus={setDates}
            onStamp={() => stamp.mutate(true)}
            onClearStamp={() => stamp.mutate(false)}
          />
          <IpasCostingSection
            ipas={ipas}
            canChange={canChange}
            onSetStatus={(computationStatus) => pick.mutate({ computationStatus })}
            onSetSplit={(landedCostSplit) => pick.mutate({ landedCostSplit })}
          />
          <IpasFilingSection
            ipas={ipas}
            rights={filingRights}
            busy={give.isPending}
            onGive={giveSignoff}
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

      <SendBackDialog
        open={sendingBack !== null}
        onOpenChange={(next) => !next && setSendingBack(null)}
        title={`Send section ${sendingBack ?? ""} back?`}
        description="It clears Prepared and Approved for this section and tells whoever prepared it. The history keeps what was cleared."
        onSubmit={(reason) => sendBack.mutateAsync({ section: sendingBack, reason })}
      />

      <FilingDialog
        open={filing}
        onOpenChange={setFiling}
        ipasId={id}
        number={ipas.number}
        onConfirm={() => give.mutateAsync({ role: IPAS_SIGNOFF_ROLE.APPROVED, confirm: true })}
      />

      <SendBackDialog
        open={reopening}
        onOpenChange={setReopening}
        title={`Reopen ${ipas.number}?`}
        description="It returns to open and section 7's sign-offs are cleared (the history keeps them). Sections 1 and 3 stay approved. Filing it again takes section 7 from Received."
        placeholder="Why is this filed IPAS being reopened?"
        submitLabel="Reopen"
        busyLabel="Reopening…"
        onSubmit={(reason) => reopen.mutateAsync(reason)}
      />

      <DocumentDialog open={documentDialog} onOpenChange={setDocumentDialog} ipas={ipas} onAdded={changed} />

      <DatesDialog
        open={dates !== null}
        onOpenChange={(next) => !next && setDates(null)}
        title={dates === "origin" ? "Supplier Origin" : `Type ${IPAS_TYPED_STATUS_LABELS[dates] ?? "the date"}`}
        description={
          dates === "origin"
            ? "When the goods shipped, went onboard and arrived. Import only."
            : "Who typed it and when is kept with the date and in history."
        }
        fields={dateFields}
        onSubmit={(values) => saveDates.mutateAsync(values)}
      />

      <ConfirmDialog
        open={removingDocument !== null}
        onOpenChange={(next) => !next && setRemovingDocument(null)}
        title={`Remove ${removingDocument?.label ?? "this document"}?`}
        description="The row leaves the IPAS, with its attachment. The history keeps what was removed."
        confirmLabel="Remove"
        cancelLabel="Keep it"
        tone="destructive"
        onConfirm={() => removingDocument && removeDocument.mutate(removingDocument)}
      />

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
