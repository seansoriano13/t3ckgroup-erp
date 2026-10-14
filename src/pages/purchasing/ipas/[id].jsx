import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowLeft, ReceiptText } from "lucide-react";

import ProtectedRoute from "../../../components/ProtectedRoute";
import PageShell from "../../../components/ui/PageShell";
import PageLoading from "../../../components/ui/PageLoading";
import EmptyState from "../../../components/ui/EmptyState";
import QueryError from "../../../components/ui/QueryError";
import ConfirmDialog from "../../../components/ui/ConfirmDialog";
import { Textarea } from "../../../components/ui/textarea";
import { FieldBox } from "../../../components/ui/FieldBox";
import EditPurposeSorsDialog from "../../../components/ipas/EditPurposeSorsDialog";
import EditValueDialog from "../../../components/ipas/EditValueDialog";
import PaymentDialog from "../../../components/ipas/PaymentDialog";
import ChargeDialog from "../../../components/ipas/ChargeDialog";
import BankDetailsDialog from "../../../components/ipas/BankDetailsDialog";
import DocumentDialog from "../../../components/ipas/DocumentDialog";
import DatesDialog from "../../../components/ipas/DatesDialog";
import SendBackDialog from "../../../components/ipas/SendBackDialog";
import FilingDialog from "../../../components/ipas/FilingDialog";
import { IpasFiledNotice } from "../../../components/ipas/IpasFiling";
import { IpasWarnings } from "../../../components/ipas/IpasSections";
import DecisionCard from "../../../components/ipas/record/DecisionCard";
import Figures from "../../../components/ipas/record/Figures";
import HeaderActions from "../../../components/ipas/record/HeaderActions";
import SectionDrawer from "../../../components/ipas/record/SectionDrawer";
import SectionsList from "../../../components/ipas/record/SectionsList";
import { buildBlocks } from "../../../components/ipas/record/blocks";
import { digestIpas } from "../../../components/ipas/record/digest";
import { useOpenSection } from "../../../components/ipas/record/useOpenSection";
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
import { canSendBackSection7, isCostsComplete, section7Rights, signoffRights } from "../../../utils/ipasSignoffs";
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
  ipasSectionLabel,
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
  // The section the drawer shows (?open=), and each section row, so focus can go back to it.
  const { index, current, open: openSection, step: stepSection, close: closeSection } = useOpenSection();
  const rowEls = useRef({});

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
            ? `Section ${ipasSectionLabel(section)} prepared. The approvers were told.`
            : `Section ${ipasSectionLabel(section)} prepared. Nobody is on its approval list yet.`,
        );
      } else {
        toast.success(`Section ${ipasSectionLabel(section)} approved.`);
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
      else toast.success(`Section ${ipasSectionLabel(7)} ${IPAS_SIGNOFF_ROLE_LABELS[role].toLowerCase()}.`);
      signoffChanged();
    },
    onError: (error) => toast.error(ipasErrorMessage(error)),
  });

  const reopen = useMutation({
    mutationFn: (reason) => ipasService.reopen(id, reason),
    onSuccess: () => {
      toast.success(`${ipas.number} is open again. The sign-offs of section ${ipasSectionLabel(7)} were cleared.`);
      signoffChanged();
    },
    onError: (error) => toast.error(ipasErrorMessage(error)),
  });

  const sendBack = useMutation({
    mutationFn: ({ section, reason }) => ipasService.sendBack(id, section, reason),
    onSuccess: (_, { section }) => {
      toast.success(
        section === 7
          ? `Section ${ipasSectionLabel(7)} sent back. Received, Noted and Checked were cleared and the people who gave them were told.`
          : `Section ${ipasSectionLabel(section)} sent back to its preparer.`,
      );
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

  // Section 2's two ticks (#241): plain, not sign-off gated.
  const tickSheet = useMutation({
    mutationFn: ({ field, value }) =>
      ipasService.setHeader(id, {
        googleSheet: field === IPAS_HEADER_FIELD.GOOGLE_SHEET ? value : undefined,
        ganttChart: field === IPAS_HEADER_FIELD.GANTT_CHART ? value : undefined,
      }),
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

  // The link has an href for when #531's card region is absent; where it is, the
  // jump also moves focus there.
  const skipToYourMove = (event) => {
    const target = document.getElementById("your-move");
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ block: "start" });
    target.focus({ preventScroll: true });
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
  const digest = digestIpas(ipas);

  // The sign-offs of sections 1 and 3: what this person may do on each.
  const sectionRights = (section) =>
    signoffRights({
      section,
      sectionState: ipas.signoffSections[section],
      userId: user?.id,
      hasPurchasingFlow,
      lists: signerLists,
      ipasState: ipas.state,
    });

  // Section 7: what this person may give, from where it stands.
  const filingRights = section7Rights({
    state: ipas.signoffSections[7],
    userId: user?.id,
    lists: signerLists,
    ipasState: ipas.state,
    costsComplete: isCostsComplete(ipas.computationStatus),
  });
  const canReturnSection7 = canSendBackSection7({
    state: ipas.signoffSections[7],
    userId: user?.id,
    lists: signerLists,
    ipasState: ipas.state,
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

  // Everything the record's header, decider and sections can ask the page to do.
  const on = {
    print: () => startPrint(false),
    printFiling: () => startPrint(true),
    editPurpose: () => setEditing(true),
    cancel: () => setCancelling(true),
    reopen: () => setReopening(true),
    editOverride: setOverriding,
    resetOverride: (field) => reset.mutate(field),
    editHeader: setTyping,
    editAmount: () => setTyping(IPAS_HEADER_FIELD.PI_QT_AMOUNT),
    pickFreight: (optionId) => pick.mutate({ freightServiceId: optionId }),
    addPayment: () => setPaymentDialog({ payment: null }),
    editPayment: (payment) => setPaymentDialog({ payment }),
    removePayment: (payment) => setRemoving({ type: "payment", row: payment }),
    tickSheet: (field, value) => tickSheet.mutate({ field, value }),
    addCharge: () => setChargeDialog({ charge: null }),
    editCharge: (charge) => setChargeDialog({ charge }),
    removeCharge: (charge) => setRemoving({ type: "charge", row: charge }),
    tickDocument: (document, side, value) => tick.mutate({ document, side, value }),
    // attach's onError has already toasted the reason; the catch keeps the rejection from escaping.
    attach: (document, url) => attach.mutateAsync({ document, url }).catch(() => {}),
    removeAttachment: (document) => attach.mutate({ document, url: "" }),
    addDocument: () => setDocumentDialog(true),
    suggestDocuments: () => suggest.mutate(),
    removeDocument: setRemovingDocument,
    editBank: () => setBankDialog(true),
    pickLocation: (optionId) => locate.mutate(optionId),
    editOrigin: () => setDates("origin"),
    editStatus: setDates,
    stamp: () => stamp.mutate(true),
    clearStamp: () => stamp.mutate(false),
    setComputationStatus: (computationStatus) => pick.mutate({ computationStatus }),
    setSplit: (landedCostSplit) => pick.mutate({ landedCostSplit }),
    prepare: (section) => signoff.mutate({ section, role: IPAS_SIGNOFF_ROLE.PREPARED }),
    approve: (section) => signoff.mutate({ section, role: IPAS_SIGNOFF_ROLE.APPROVED }),
    sendBack: (section) => setSendingBack(section),
    give: giveSignoff,
  };

  const ctx = {
    ipas,
    refresh: refresh.data,
    refreshing: refresh.isFetching,
    can: {
      change: canChange,
      record: canRecord,
      tickFinance: canTickFinance,
      reopen: isSuperAdmin && filed,
      printFiling: filed && ipas.canReadBankDetails,
    },
    rights: { 1: sectionRights(1), 3: sectionRights(3), 7: filingRights, sendBack7: canReturnSection7 },
    busy: {
      signoff: signoff.isPending || sendBack.isPending,
      give: give.isPending || sendBack.isPending,
      print: print.isPending,
    },
    on,
    back,
    printedBy: user?.name ?? null,
  };
  const blocks = buildBlocks(ctx);

  return (
    <>
      <PageShell
        title={ipas.number}
        description={[ipas.po_number, ipas.supplier].filter(Boolean).join(" · ")}
        action={<HeaderActions ctx={ctx} />}
      >
        <div className="space-y-6">
          {/* Keyboard users skip the figures and sections to the card; hidden until focused. */}
          <Link
            to="#your-move"
            onClick={skipToYourMove}
            className="sr-only text-sm font-medium text-foreground underline underline-offset-4 focus-visible:not-sr-only focus-visible:absolute focus-visible:top-2 focus-visible:left-4 focus-visible:z-50 focus-visible:rounded-md focus-visible:bg-card focus-visible:px-3 focus-visible:py-2 focus-visible:shadow-sm focus-visible:ring-3 focus-visible:ring-mauve-11"
          >
            Skip to your move
          </Link>
          <div className="space-y-2 empty:hidden">
            {cancelled && (
              <div role="status" className="rounded-xl border border-border bg-muted/40 p-3 text-sm">
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

            <IpasWarnings
              ipas={ipas}
              refresh={refresh.data}
              onRetry={() => refresh.refetch()}
              retrying={refresh.isFetching}
            />
          </div>

          {/* The decider: the figures and sections on the left, the card beside them from the wide breakpoint. */}
          <div className="grid gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="min-w-0 space-y-8">
              <Figures digest={digest} onOpen={openSection} />
              <SectionsList
                ipas={ipas}
                digest={digest}
                onOpen={openSection}
                rowRef={(key) => (node) => {
                  rowEls.current[key] = node;
                }}
              />
            </div>
            <aside className="custom-scrollbar min-w-0 xl:sticky xl:top-2 xl:order-last xl:max-h-[calc(100dvh-7.5rem)] xl:self-start xl:overflow-y-auto">
              <DecisionCard ctx={ctx} digest={digest} />
            </aside>
          </div>
        </div>

        <SectionDrawer
          ctx={ctx}
          blocks={blocks}
          digest={digest}
          index={index}
          current={current}
          step={stepSection}
          close={closeSection}
          getRow={(key) => rowEls.current[key]}
        />
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
        title={`Send section ${sendingBack === null ? "" : ipasSectionLabel(sendingBack)} back?`}
        description={
          sendingBack === 7
            ? `It clears Received, Noted and Checked and tells the people who gave them. Sections ${ipasSectionLabel(1)} and ${ipasSectionLabel(3)} stay approved. The history keeps what was cleared.`
            : "It clears Prepared and Approved for this section and tells whoever prepared it. The history keeps what was cleared."
        }
        placeholder={sendingBack === 7 ? "What needs fixing before it is filed?" : undefined}
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
        description={`It returns to open and the sign-offs of section ${ipasSectionLabel(7)} are cleared (the history keeps them). Sections ${ipasSectionLabel(1)} and ${ipasSectionLabel(3)} stay approved. Filing it again takes section ${ipasSectionLabel(7)} from Received.`}
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
