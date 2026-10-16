import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowLeft, ReceiptText } from "lucide-react";

import ProtectedRoute from "../../../components/ProtectedRoute";
import { Button } from "../../../components/ui/button";
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
import ReturnDialog from "../../../components/ipas/ReturnDialog";
import FilingDialog from "../../../components/ipas/FilingDialog";
import { IpasFiledNotice } from "../../../components/ipas/IpasFiling";
import { IpasWarnings } from "../../../components/ipas/IpasSections";
import DecisionCard from "../../../components/ipas/record/DecisionCard";
import InlineError from "../../../components/record/InlineError";
import Figures from "../../../components/ipas/record/Figures";
import HeaderActions from "../../../components/ipas/record/HeaderActions";
import SectionDrawer from "../../../components/ipas/record/SectionDrawer";
import SectionsList from "../../../components/ipas/record/SectionsList";
import { buildBlocks } from "../../../components/ipas/record/blocks";
import { digestIpas, filingSummary, isInPlace } from "../../../components/ipas/record/digest";
import { CHROME, RecordSectionChrome } from "../../../components/record/sectionChrome";
import { useEditSection } from "../../../components/ipas/record/useEditSection";
import { useOpenSection } from "../../../components/ipas/record/useOpenSection";
import {
  ipasKey,
  ipasListKey,
  ipasPendingKey,
  ipasPendingPrefix,
  ipasRefreshKey,
  ipasSignerListsKey,
} from "../../../components/ipas/ipasKeys";
import { ipasService } from "../../../services/ipasService";
import * as optimistic from "../../../utils/ipasOptimistic";
import { openPrintWindow, printIpas } from "../../../lib/pdf/ipasPrinter";
import { undoableSuccessToast } from "../../../components/ui/CustomToast";
import { useAuth } from "../../../context/AuthContext";
import { getPermissionContext } from "../../../utils/permissions";
import { ipasErrorMessage } from "../../../utils/ipas";
import { parseAmountInput } from "../../../utils/ipasPayments";
import {
  canSendBackSection7,
  canSetComputationStatus,
  isLandedCostFinal,
  section7Rights,
  signoffRights,
} from "../../../utils/ipasSignoffs";
import { formatDate } from "../../../utils/formatDate.js";
import {
  IPAS_COMPUTATION_STATUS,
  IPAS_COMPUTATION_STATUS_LABELS,
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
  [IPAS_HEADER_FIELD.SUPPLIER_CONTACT]: "Supplier's name",
  [IPAS_HEADER_FIELD.PI_NUMBER]: "P.I #",
  [IPAS_HEADER_FIELD.PI_QT_AMOUNT]: "P.I/QT Amount",
};

/** The fixed currency shown before a typed amount ("PHP", "USD"; pesos when the PO has none). */
function currencyPrefix(currency) {
  return (currency || "PHP").toString().toUpperCase();
}

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
 * Return with a reason (the section's list). Each person is offered only
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
  const by = user ? { id: user.id, name: user.name, avatarPath: user.avatarPath ?? user.avatar_path ?? null } : null;

  // UI first: apply `edit` to the cached IPAS at once and return what undoes it. The
  // server catches up behind (each mutation refetches when it settles); a failure
  // puts the page back and says why, with Retry.
  const patchCache = (edit) => {
    const key = ipasKey(id);
    queryClient.cancelQueries({ queryKey: key });
    const previous = queryClient.getQueryData(key);
    if (previous?.raw) queryClient.setQueryData(key, optimistic.reshapeIpas(previous, edit));
    return () => {
      if (previous) queryClient.setQueryData(key, previous);
      queryClient.invalidateQueries({ queryKey: key });
    };
  };
  // The Return dialog: { section | null, from } while open. `section` null lists every section the viewer may return.
  const [returning, setReturning] = useState(null);
  // The Approve and file dialog, and where it was started ({ from }), or null when shut.
  const [filing, setFiling] = useState(null);
  const [reopening, setReopening] = useState(false);
  // A failed move, shown at the place it was started (card or drawer footer), with Retry.
  const [failure, setFailure] = useState(null);
  // The IPAS this viewer just signed, so the card can point at the next one waiting for them.
  const [signedId, setSignedId] = useState(null);
  // A failed change (see failChange), kept with Retry where it was made: `key` is the
  // edit view's section, or null on the overview (a Logistics pick, the status stamp, Mark costs undo).
  const [changeFailure, setChangeFailure] = useState(null);

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
  const { index, current, inPlace, open: openDrawer, step: stepSection, close: closeSection } = useOpenSection();
  // The section in the edit view (?edit=), and the section last left, to focus its row on the way back.
  const { key: editKey, edit: openEdit, leave: leaveEdit } = useEditSection();
  const editedKey = useRef(null);
  const rowEls = useRef({});
  const openSection = (key) => openDrawer(key);
  // Back from the edit view lands on that section's drawer, where it was opened from.
  const backToPreview = () => leaveEdit(editKey);

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

  // Who is on each sign-off list, so the page offers Approve and Return only
  // to people on one. It never fails the page: no lists reads as nobody.
  const { data: signerLists } = useQuery({
    queryKey: ipasSignerListsKey,
    queryFn: () => ipasService.getSignerLists(),
    enabled: Boolean(id),
  });

  // Leaving the edit view (its link, or Back) returns to the overview with that section's row focused.
  useEffect(() => {
    if (editKey) {
      editedKey.current = editKey;
      return;
    }
    const from = editedKey.current;
    if (!from) return;
    editedKey.current = null;
    if (!current && !inPlace) rowEls.current[from]?.focus();
  }, [editKey, current, inPlace]);

  useEffect(() => {
    if (!refresh.dataUpdatedAt) return;
    queryClient.invalidateQueries({ queryKey: ipasKey(id) });
    queryClient.invalidateQueries({ queryKey: ipasListKey });
  }, [refresh.dataUpdatedAt, id, queryClient]);

  const changed = () => {
    setChangeFailure(null);
    queryClient.invalidateQueries({ queryKey: ipasKey(id) });
    queryClient.invalidateQueries({ queryKey: ipasListKey });
  };

  // A failed change: the toast as ever, and the message kept with Retry, which runs
  // the same change again. In the edit view it sits in that view's header, tagged
  // with its section; on the overview it sits at the top of the page.
  const failChange = (error, retry) => {
    const message = ipasErrorMessage(error);
    toast.error(message);
    setChangeFailure({ key: editKey ?? null, message, retry });
  };
  // Only the failure made in the view now showing.
  const shownFailure = changeFailure?.key === (editKey ?? null) ? changeFailure : null;

  // A sign-off moves the Approval Center queue and its badge too.
  const signoffChanged = () => {
    changed();
    queryClient.invalidateQueries({ queryKey: ipasPendingPrefix });
  };

  // A failed move: the toast as ever, and the message kept at the move's origin
  // (`from`: the key and where it was started) with Retry, which runs `retry` again.
  const failMove = (error, from, retry) => {
    const message = ipasErrorMessage(error);
    toast.error(message);
    if (from) setFailure({ key: from.key, origin: from.origin, message, retry });
  };
  const markSigned = () => setSignedId(id);

  const signoff = useMutation({
    mutationFn: ({ section, role }) => ipasService.sign(id, section, role),
    onMutate: ({ section, role }) => ({
      rollback: patchCache(optimistic.giveSignoff({ section, role, by, ipasId: id })),
    }),
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
      setFailure(null);
      markSigned();
      signoffChanged();
    },
    onError: (error, vars, context) => {
      context?.rollback?.();
      failMove(error, vars.from, () => signoff.mutate(vars));
    },
  });

  // Section 7's steps. Approved files the IPAS and goes through the dialog that
  // lists the required documents nobody has ticked; `confirm` is the user's yes.
  const give = useMutation({
    mutationFn: ({ role, confirm }) => ipasService.sign(id, 7, role, { confirm }),
    // Filing (Approved) waits for the server: it freezes the IPAS.
    onMutate: ({ role }) =>
      role === IPAS_SIGNOFF_ROLE.APPROVED
        ? {}
        : { rollback: patchCache(optimistic.giveSignoff({ section: 7, role, by, ipasId: id })) },
    onSuccess: (result, { role }) => {
      if (result.filed) toast.success(`${ipas.number} is filed.`);
      else toast.success(`Section ${ipasSectionLabel(7)} ${IPAS_SIGNOFF_ROLE_LABELS[role].toLowerCase()}.`);
      setFailure(null);
      markSigned();
      signoffChanged();
    },
    onError: (error, vars, context) => {
      context?.rollback?.();
      failMove(error, vars.from, () => give.mutate(vars));
    },
  });

  // The card's next computation status, or any step the body's control picks.
  // The card's step is undoable: its toast restores the status it came from,
  // through this same mutation.
  const setStatus = useMutation({
    mutationFn: ({ computationStatus }) => ipasService.setHeader(id, { computationStatus }),
    onMutate: ({ computationStatus }) => ({
      rollback: patchCache(optimistic.setRow({ computation_status: computationStatus })),
    }),
    onSuccess: (_, { computationStatus, undoTo, undo, from }) => {
      setFailure(null);
      changed();
      if (undo) {
        toast.success(`Computation status is back to ${IPAS_COMPUTATION_STATUS_LABELS[computationStatus]}.`);
      } else if (undoTo !== undefined && from && computationStatus === IPAS_COMPUTATION_STATUS.LC_ODOO_DONE) {
        undoableSuccessToast("LC Odoo Done. Landed Cost is final.", "Undo", () =>
          setStatus.mutate({ computationStatus: undoTo, undo: true }),
        );
      } else if (undoTo !== undefined && from) {
        undoableSuccessToast(`${IPAS_COMPUTATION_STATUS_LABELS[computationStatus]} marked.`, "Undo", () =>
          setStatus.mutate({ computationStatus: undoTo, undo: true }),
        );
      }
    },
    onError: (error, vars, context) => {
      context?.rollback?.();
      const retry = () => setStatus.mutate(vars);
      // From the card (the next LC step) the failure shows there; from the edit view, in its header.
      if (vars.from) failMove(error, vars.from, retry);
      else failChange(error, retry);
    },
  });

  // The next IPAS waiting for this viewer, after one of their sign-offs here.
  const pending = useQuery({
    queryKey: ipasPendingKey(user?.id),
    queryFn: () => ipasService.pendingSignoffsFor(user.id),
    enabled: Boolean(user?.id) && signedId === id,
  });
  const nextIpas = signedId === id ? (pending.data ?? []).find((item) => item.ipasId !== id) ?? null : null;

  const reopen = useMutation({
    mutationFn: (reason) => ipasService.reopen(id, reason),
    onSuccess: () => {
      toast.success(`${ipas.number} is open again. The sign-offs of section ${ipasSectionLabel(7)} were cleared.`);
      signoffChanged();
    },
    onError: (error) => toast.error(ipasErrorMessage(error)),
  });

  // A Return, or an Undo approval: both leave the card at once and the server follows.
  const returnSection = useMutation({
    mutationFn: ({ section, mode, reason }) =>
      mode === "undo" ? ipasService.undoApproval(id, section, reason) : ipasService.sendBack(id, section, reason),
    onMutate: ({ section, mode, reason }) => ({
      rollback: patchCache(optimistic.returnSection({ section, undo: mode === "undo", by, reason })),
    }),
    onSuccess: (_, { section, mode }) => {
      setChangeFailure(null);
      if (mode === "undo") {
        toast.success(`Approval of section ${ipasSectionLabel(section)} undone. It waits for an approver again.`);
      } else if (section === 7) {
        toast.success(
          `Section ${ipasSectionLabel(7)} returned. Received, Noted and Checked were cleared and the people who gave them were told.`,
        );
      } else {
        toast.success(`Section ${ipasSectionLabel(section)} returned to its preparer.`);
      }
      signoffChanged();
    },
    onError: (error, vars, context) => {
      context?.rollback?.();
      failChange(error, () => returnSection.mutate(vars));
    },
  });

  const override = useMutation({
    mutationFn: ({ field, value }) => ipasService.overrideField(id, field, value),
    onMutate: ({ field, value }) => ({
      rollback: patchCache(optimistic.setRow({ [IPAS_OVERRIDE_FIELDS[field].column]: (value ?? "").trim() || null })),
    }),
    onSuccess: (_, { field }) => {
      toast.success(`${IPAS_OVERRIDE_FIELDS[field].label} overridden. Odoo's value stays beside it.`);
      changed();
    },
    onError: (error, vars, context) => {
      context?.rollback?.();
      failChange(error, () => override.mutate(vars));
    },
  });

  const reset = useMutation({
    mutationFn: (field) => ipasService.resetOverride(id, field),
    onMutate: (field) => ({ rollback: patchCache(optimistic.setRow({ [IPAS_OVERRIDE_FIELDS[field].column]: null })) }),
    onSuccess: (_, field) => {
      toast.success(`${IPAS_OVERRIDE_FIELDS[field].label} is back to Odoo's value.`);
      changed();
    },
    onError: (error, field, context) => {
      context?.rollback?.();
      failChange(error, () => reset.mutate(field));
    },
  });

  const typeHeader = useMutation({
    mutationFn: ({ field, value }) =>
      ipasService.setHeader(id, {
        supplierContact: field === IPAS_HEADER_FIELD.SUPPLIER_CONTACT ? value : undefined,
        piNumber: field === IPAS_HEADER_FIELD.PI_NUMBER ? value : undefined,
        piQtAmount: field === IPAS_HEADER_FIELD.PI_QT_AMOUNT ? value : undefined,
      }),
    onMutate: ({ field, value }) => ({
      rollback: patchCache(
        optimistic.setRow(
          optimistic.headerColumns({
            supplierContact: field === IPAS_HEADER_FIELD.SUPPLIER_CONTACT ? value : undefined,
            piNumber: field === IPAS_HEADER_FIELD.PI_NUMBER ? value : undefined,
            piQtAmount: field === IPAS_HEADER_FIELD.PI_QT_AMOUNT ? value : undefined,
          }),
        ),
      ),
    }),
    onSuccess: (_, { field }) => {
      toast.success(`${HEADER_LABELS[field]} saved.`);
      changed();
    },
    onError: (error, vars, context) => {
      context?.rollback?.();
      failChange(error, () => typeHeader.mutate(vars));
    },
  });

  // Freight service, the computation status and how charges are spread: one
  // picked value each, kept in history with what it was.
  const pick = useMutation({
    mutationFn: (values) => ipasService.setHeader(id, values),
    onMutate: (values) => ({ rollback: patchCache(optimistic.setRow(optimistic.headerColumns(values))) }),
    onSuccess: () => changed(),
    onError: (error, vars, context) => {
      context?.rollback?.();
      failChange(error, () => pick.mutate(vars));
    },
  });

  // Section 2's two ticks (#241): plain, not sign-off gated.
  const tickSheet = useMutation({
    mutationFn: ({ field, value }) =>
      ipasService.setHeader(id, {
        googleSheet: field === IPAS_HEADER_FIELD.GOOGLE_SHEET ? value : undefined,
        ganttChart: field === IPAS_HEADER_FIELD.GANTT_CHART ? value : undefined,
      }),
    onMutate: ({ field, value }) => ({
      rollback: patchCache(
        optimistic.setRow(
          optimistic.headerColumns({
            googleSheet: field === IPAS_HEADER_FIELD.GOOGLE_SHEET ? value : undefined,
            ganttChart: field === IPAS_HEADER_FIELD.GANTT_CHART ? value : undefined,
          }),
        ),
      ),
    }),
    onSuccess: () => changed(),
    onError: (error, vars, context) => {
      context?.rollback?.();
      failChange(error, () => tickSheet.mutate(vars));
    },
  });

  const remove = useMutation({
    mutationFn: ({ type, row }) =>
      type === "payment" ? ipasService.removePayment(row.id) : ipasService.removeCharge(row.id),
    onMutate: ({ type, row }) => {
      setRemoving(null);
      return {
        rollback: patchCache(type === "payment" ? optimistic.removePayment(row.id) : optimistic.removeCharge(row.id)),
      };
    },
    onSuccess: (_, { type }) => {
      toast.success(type === "payment" ? "Payment removed." : "Charge removed.");
      changed();
    },
    onError: (error, vars, context) => {
      context?.rollback?.();
      failChange(error, () => remove.mutate(vars));
    },
  });

  // Documents (#246). Each tick is its own department's: the database refuses
  // the other's, and the page only offers each person their own box.
  const tick = useMutation({
    mutationFn: ({ document, side, value }) => ipasService.tickDocument(document.id, side, value),
    onMutate: ({ document, side, value }) => ({ rollback: patchCache(optimistic.tickDocument(document.id, side, value)) }),
    onSuccess: changed,
    onError: (error, vars, context) => {
      context?.rollback?.();
      failChange(error, () => tick.mutate(vars));
    },
  });

  const attach = useMutation({
    mutationFn: ({ document, url }) => ipasService.setDocument(document.id, { attachmentUrl: url }),
    onMutate: ({ document, url }) => ({ rollback: patchCache(optimistic.attachDocument(document.id, url)) }),
    onSuccess: (_, { url }) => {
      toast.success(url ? "File attached." : "Attachment removed.");
      changed();
    },
    onError: (error, vars, context) => {
      context?.rollback?.();
      failChange(error, () => attach.mutate(vars));
    },
  });

  const suggest = useMutation({
    mutationFn: () => ipasService.suggestDocuments(id),
    onSuccess: (added) => {
      toast.success(added.length === 1 ? `${added[0]} added.` : `${added.length} documents added.`);
      changed();
    },
    onError: (error) => failChange(error, () => suggest.mutate()),
  });

  const removeDocument = useMutation({
    mutationFn: (document) => ipasService.removeDocument(document.id),
    onMutate: (document) => {
      setRemovingDocument(null);
      return { rollback: patchCache(optimistic.removeDocument(document.id)) };
    },
    onSuccess: () => {
      toast.success("Document removed.");
      changed();
    },
    onError: (error, document, context) => {
      context?.rollback?.();
      failChange(error, () => removeDocument.mutate(document));
    },
  });

  // The payment, charge, bank and document forms close the moment they are saved: the
  // row (or the new figures) shows now, and a failure puts the page back with Retry.
  const savePayment = useMutation({
    mutationFn: ({ payment, values, isPhpPo }) =>
      payment ? ipasService.updatePayment(payment.id, values, { isPhpPo }) : ipasService.addPayment(id, values, { isPhpPo }),
    onMutate: ({ payment, values, isPhpPo }) => ({
      rollback: patchCache(
        optimistic.savePayment({ paymentId: payment?.id ?? null, values, isPhpPo, ipasId: id, by }),
      ),
    }),
    onSuccess: (_, { payment }) => {
      toast.success(payment ? "Payment updated." : "Payment recorded.");
      changed();
    },
    onError: (error, vars, context) => {
      context?.rollback?.();
      failChange(error, () => savePayment.mutate(vars));
    },
  });

  const saveCharge = useMutation({
    mutationFn: ({ charge, values }) =>
      charge ? ipasService.updateCharge(charge.id, values) : ipasService.addCharge(id, values),
    onMutate: ({ charge, values }) => ({
      rollback: patchCache(optimistic.saveCharge({ chargeId: charge?.id ?? null, values, ipasId: id, by })),
    }),
    onSuccess: (_, { charge }) => {
      toast.success(charge ? "Charge updated." : "Charge recorded.");
      changed();
    },
    onError: (error, vars, context) => {
      context?.rollback?.();
      failChange(error, () => saveCharge.mutate(vars));
    },
  });

  const saveBank = useMutation({
    mutationFn: (values) => ipasService.setBankDetails(id, values),
    onMutate: (values) => {
      const key = ipasKey(id);
      queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      if (previous) queryClient.setQueryData(key, optimistic.withBankDetails(previous, values));
      return {
        rollback: () => {
          if (previous) queryClient.setQueryData(key, previous);
          queryClient.invalidateQueries({ queryKey: key });
        },
      };
    },
    onSuccess: (result) => {
      if (result.flagged && result.accountChanged) {
        toast.error("Account # differs from this supplier's last IPAS. It is flagged and its approvals were cleared.", {
          duration: 8000,
        });
      } else {
        toast.success("Bank details saved.");
      }
      signoffChanged();
    },
    onError: (error, vars, context) => {
      context?.rollback?.();
      failChange(error, () => saveBank.mutate(vars));
    },
  });

  const addDocument = useMutation({
    mutationFn: (choice) => ipasService.addDocument(id, choice),
    onMutate: (choice) => ({ rollback: patchCache(optimistic.addDocument({ ...choice, ipasId: id })) }),
    onSuccess: () => {
      toast.success("Document added.");
      changed();
    },
    onError: (error, vars, context) => {
      context?.rollback?.();
      failChange(error, () => addDocument.mutate(vars));
    },
  });

  // Supplier Origin, the typed statuses, Actual Checking and Item Location.
  // `kind` is "origin" or a typed status key; it travels with the values, so Retry
  // still knows what it was saving after the dialog has closed.
  const saveDates = useMutation({
    mutationFn: ({ kind, values }) =>
      kind === "origin"
        ? ipasService.setSupplierOrigin(id, values)
        : ipasService.setTypedStatus(id, kind, Object.values(values)[0] ?? ""),
    onMutate: ({ kind, values }) => {
      if (kind !== "origin") {
        return { rollback: patchCache(optimistic.setTypedStatus({ status: kind, date: Object.values(values)[0] ?? "", by })) };
      }
      const columns = {};
      for (const { field, column } of IPAS_SUPPLIER_ORIGIN_FIELDS) {
        if (values[field] !== undefined) columns[column] = (values[field] ?? "").trim() || null;
      }
      return { rollback: patchCache(optimistic.setOriginDates(columns)) };
    },
    onSuccess: (_, { kind }) => {
      toast.success(kind === "origin" ? "Supplier Origin saved." : `${IPAS_TYPED_STATUS_LABELS[kind]} saved.`);
      changed();
    },
    onError: (error, vars, context) => {
      context?.rollback?.();
      failChange(error, () => saveDates.mutate(vars));
    },
  });

  const stamp = useMutation({
    mutationFn: (stamped) => ipasService.stampActualChecking(id, { stamped }),
    onMutate: (stamped) => ({ rollback: patchCache(optimistic.stampActualChecking({ stamped, by })) }),
    onSuccess: (_, stamped) => {
      toast.success(stamped ? "Actual Checking stamped." : "Actual Checking stamp cleared.");
      changed();
    },
    onError: (error, stamped, context) => {
      context?.rollback?.();
      failChange(error, () => stamp.mutate(stamped));
    },
  });

  const locate = useMutation({
    mutationFn: (optionId) => ipasService.setItemLocation(id, optionId),
    onMutate: (optionId) => ({ rollback: patchCache(optimistic.setItemLocation(optionId)) }),
    onSuccess: changed,
    onError: (error, optionId, context) => {
      context?.rollback?.();
      failChange(error, () => locate.mutate(optionId));
    },
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
    costsComplete: isLandedCostFinal(ipas.computationStatus),
  });
  const canReturnSection7 = canSendBackSection7({
    state: ipas.signoffSections[7],
    userId: user?.id,
    lists: signerLists,
    ipasState: ipas.state,
  });
  // `from` is where the move was started, for a failure to show there.
  const giveSignoff = (role, from) => {
    if (role === IPAS_SIGNOFF_ROLE.APPROVED) setFiling({ from });
    else give.mutate({ role, confirm: false, from });
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

  // The Return dialog's choices: each section the viewer may return or undo, with what it
  // would clear in section 4 (named, so the signer is mindful).
  const filingGiven = [IPAS_SIGNOFF_ROLE.RECEIVED, IPAS_SIGNOFF_ROLE.NOTED, IPAS_SIGNOFF_ROLE.CHECKED]
    .map((role) => {
      const signed = ipas.signoffSections[7][role];
      return signed ? `${IPAS_SIGNOFF_ROLE_LABELS[role]} by ${signed.signedBy?.name ?? "someone"}` : null;
    })
    .filter(Boolean);
  const returnTargets = [1, 3]
    .filter((section) => sectionRights(section).returnMode)
    .map((section) => {
      const undo = sectionRights(section).returnMode === "undo";
      return {
        section,
        mode: undo ? "undo" : "return",
        label: ipasSectionLabel(section),
        effect: undo
          ? "Takes back the approval only. Prepared stays, so it waits for an approver again."
          : "Clears Prepared and Approved and tells whoever prepared it.",
        clears: filingGiven.map((line) => `${ipasSectionLabel(7)}: ${line}`),
      };
    });
  if (canReturnSection7) {
    returnTargets.push({
      section: 7,
      mode: "return",
      label: ipasSectionLabel(7),
      effect: `Clears Received, Noted and Checked and tells who gave them. Sections ${ipasSectionLabel(1)} and ${ipasSectionLabel(3)} stay approved.`,
      placeholder: "What needs fixing before it is filed?",
      clears: [],
    });
  }
  const shownReturnTargets =
    returning?.section == null ? returnTargets : returnTargets.filter((target) => target.section === returning.section);

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
    setComputationStatus: (computationStatus, from) =>
      setStatus.mutate({ computationStatus, from, undoTo: ipas.computationStatus }),
    setSplit: (landedCostSplit) => pick.mutate({ landedCostSplit }),
    prepare: (section, from) => signoff.mutate({ section, role: IPAS_SIGNOFF_ROLE.PREPARED, from }),
    approve: (section, from) => signoff.mutate({ section, role: IPAS_SIGNOFF_ROLE.APPROVED, from }),
    openReturn: (section, from) => setReturning({ section, from }),
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
      // Purchasing or Finance, or a Super Admin, may give Checked by (the rest of the steps are Purchasing's).
      check: open && (hasPurchasingFlow || hasFinanceFlow || isSuperAdmin),
      setStatus: (from, to) =>
        open && canSetComputationStatus({ from, to, hasPurchasingFlow, hasFinanceFlow, isSuperAdmin }),
      reopen: isSuperAdmin && filed,
      printFiling: filed && ipas.canReadBankDetails,
    },
    rights: { 1: sectionRights(1), 3: sectionRights(3), 7: filingRights, sendBack7: canReturnSection7 },
    busy: {
      signoff: signoff.isPending || returnSection.isPending,
      give: give.isPending || returnSection.isPending,
      print: print.isPending,
    },
    on,
    back,
    printedBy: user?.name ?? null,
    viewer: user?.name ?? null,
    failure: failure && { ...failure, dismiss: () => setFailure(null) },
  };
  const blocks = buildBlocks(ctx);
  // A row opens its section in the drawer; a short section toggles in place under its row.
  const openRow = (key) => (isInPlace(key) && inPlace === key ? closeSection() : openSection(key));
  const inPlaceBodies = {
    logistics: <RecordSectionChrome.Provider value={CHROME.INLINE}>{blocks.logistics}</RecordSectionChrome.Provider>,
    status: <RecordSectionChrome.Provider value={CHROME.INLINE}>{blocks.status}</RecordSectionChrome.Provider>,
  };
  const editView = editKey ? (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={backToPreview}>
          <ArrowLeft size={14} aria-hidden="true" />
          Back to preview
        </Button>
        {shownFailure && (
          <InlineError
            message={shownFailure.message}
            onRetry={shownFailure.retry}
            onDismiss={() => setChangeFailure(null)}
          />
        )}
      </div>
      <RecordSectionChrome.Provider value={CHROME.CARD}>{blocks[editKey]}</RecordSectionChrome.Provider>
    </div>
  ) : null;

  // The dialog closes on a failure too (its onConfirm catches): the failure then
  // shows inline at the move that started it, with Retry.
  return (
    <>
      <PageShell
        title={ipas.number}
        description={[ipas.po_number, ipas.supplier].filter(Boolean).join(" · ")}
        action={<HeaderActions ctx={ctx} />}
      >
        <div className="space-y-6">
          {/* Keyboard users skip the figures and sections to the card; hidden until focused. */}
          {!editKey && (
            <Link
              to="#your-move"
              onClick={skipToYourMove}
              className="sr-only text-sm font-medium text-foreground underline underline-offset-4 focus-visible:not-sr-only focus-visible:absolute focus-visible:top-2 focus-visible:left-4 focus-visible:z-50 focus-visible:rounded-md focus-visible:bg-card focus-visible:px-3 focus-visible:py-2 focus-visible:shadow-sm focus-visible:ring-3 focus-visible:ring-ring"
            >
              Skip to your move
            </Link>
          )}
          <div className="space-y-2 empty:hidden">
            {!editKey && shownFailure && (
              <InlineError
                message={shownFailure.message}
                onRetry={shownFailure.retry}
                onDismiss={() => setChangeFailure(null)}
              />
            )}
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

          {/* The decider: the figures and sections on the left; the card beside them from the wide breakpoint, sticky and without an inner scroll. Below it the card follows the sections. */}
          {editView ?? (
            <div className="grid gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
              <div className="min-w-0 space-y-8">
                <Figures digest={digest} onOpen={openRow} />
                <SectionsList
                  digest={digest}
                  onOpen={openRow}
                  inPlace={inPlace}
                  bodies={inPlaceBodies}
                  rowRef={(key) => (node) => {
                    rowEls.current[key] = node;
                  }}
                />
              </div>
              <aside className="min-w-0 xl:sticky xl:top-2 xl:self-start">
                <DecisionCard ctx={ctx} digest={digest} onReview={openSection} next={nextIpas} />
              </aside>
            </div>
          )}
        </div>

        {!editKey && (
          <SectionDrawer
            ctx={ctx}
            blocks={blocks}
            digest={digest}
            index={index}
            current={current}
            step={stepSection}
            close={closeSection}
            getRow={(key) => rowEls.current[key]}
            onEdit={openEdit}
          />
        )}
      </PageShell>

      <EditPurposeSorsDialog ipas={ipas} open={editing} onOpenChange={setEditing} />

      <PaymentDialog
        open={paymentDialog !== null}
        onOpenChange={(next) => !next && setPaymentDialog(null)}
        ipas={ipas}
        payment={paymentDialog?.payment ?? null}
        onSave={(values, isPhpPo) => savePayment.mutate({ payment: paymentDialog?.payment ?? null, values, isPhpPo })}
      />

      <ChargeDialog
        open={chargeDialog !== null}
        onOpenChange={(next) => !next && setChargeDialog(null)}
        ipas={ipas}
        charge={chargeDialog?.charge ?? null}
        onSave={(values) => saveCharge.mutate({ charge: chargeDialog?.charge ?? null, values })}
      />

      <BankDetailsDialog
        open={bankDialog}
        onOpenChange={setBankDialog}
        ipas={ipas}
        onSave={(values) => saveBank.mutate(values)}
      />

      <ReturnDialog
        open={returning !== null && shownReturnTargets.length > 0}
        onOpenChange={(next) => !next && setReturning(null)}
        targets={shownReturnTargets}
        initial={returning?.section ?? null}
        onSubmit={(values) => {
          // UI first: the card moves on now; a failure comes back as a page notice with Retry.
          returnSection.mutate(values);
          return Promise.resolve();
        }}
      />

      <FilingDialog
        open={filing !== null}
        onOpenChange={(next) => !next && setFiling(null)}
        ipasId={id}
        number={ipas.number}
        summary={filingSummary(digest)}
        signer={user?.name ? `You sign as ${user.name}.` : null}
        onConfirm={() =>
          give
            .mutateAsync({ role: IPAS_SIGNOFF_ROLE.APPROVED, confirm: true, from: filing?.from })
            .catch(() => {})
        }
      />

      <SendBackDialog
        open={reopening}
        onOpenChange={setReopening}
        title={`Reopen ${ipas.number}?`}
        description={`It returns to open and the sign-offs of section ${ipasSectionLabel(7)} are cleared (the history keeps them). Sections ${ipasSectionLabel(1)} and ${ipasSectionLabel(3)} stay approved. Filing it again takes section ${ipasSectionLabel(7)} from Received.`}
        placeholder="Why is this filed IPAS being reopened?"
        submitLabel="Reopen"
        busyLabel="Reopening…"
        inlineError
        onSubmit={(reason) => reopen.mutateAsync(reason)}
      />

      <DocumentDialog
        open={documentDialog}
        onOpenChange={setDocumentDialog}
        ipas={ipas}
        onSave={(choice) => addDocument.mutate(choice)}
      />

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
        onSubmit={(values) => {
          saveDates.mutate({ kind: dates, values });
          return Promise.resolve();
        }}
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
        onSubmit={(value) => {
          override.mutate({ field: overriding, value });
          return Promise.resolve();
        }}
      />

      <EditValueDialog
        open={typing !== null}
        onOpenChange={(open) => !open && setTyping(null)}
        title={`Edit ${HEADER_LABELS[typing] ?? ""}`}
        description="What you type is kept; Odoo fills this only while it is blank."
        label={HEADER_LABELS[typing] ?? ""}
        prefix={typing === IPAS_HEADER_FIELD.PI_QT_AMOUNT ? currencyPrefix(ipas.currency) : undefined}
        placeholder={typing === IPAS_HEADER_FIELD.PI_QT_AMOUNT ? "0.00" : undefined}
        initialValue={typingInitialValue(typing, ipas)}
        allowBlank
        onSubmit={(value) => {
          // A half-typed amount is refused here, so the dialog stays for fixing it.
          if (typing === IPAS_HEADER_FIELD.PI_QT_AMOUNT && !parseAmountInput(value).ok) {
            const message = "P.I/QT Amount must be a number.";
            toast.error(message);
            return Promise.reject(new Error(message));
          }
          typeHeader.mutate({ field: typing, value });
          return Promise.resolve();
        }}
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
// Keyed by the IPAS, so "Next IPAS waiting for me" (same route, new id) starts
// from a clean page: no failure, dialog or sign-off from the last IPAS carries over.
export default function IpasPageRoute() {
  const { id } = useParams();
  return (
    <ProtectedRoute>
      <IpasPage key={id} />
    </ProtectedRoute>
  );
}
