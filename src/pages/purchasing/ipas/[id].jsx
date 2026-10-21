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
import DatesDialog from "../../../components/ipas/DatesDialog";
import SendBackDialog from "../../../components/ipas/SendBackDialog";
import ReturnDialog from "../../../components/ipas/ReturnDialog";
import FilingDialog from "../../../components/ipas/FilingDialog";
import { IpasFiledNotice } from "../../../components/ipas/IpasFiling";
import { IpasWarnings } from "../../../components/ipas/IpasSections";
import DecisionCard from "../../../components/ipas/record/DecisionCard";
import InlineError from "../../../components/record/InlineError";
import EditForm from "../../../components/ipas/record/EditForm";
import MoneySummary from "../../../components/ipas/record/MoneySummary";
import HeaderActions from "../../../components/ipas/record/HeaderActions";
import SectionsPanel from "../../../components/ipas/record/SectionsPanel";
import { buildBlocks } from "../../../components/ipas/record/blocks";
import { digestIpas, filingSummary } from "../../../components/ipas/record/digest";
import { useEditSection } from "../../../components/ipas/record/useEditSection";
import { loadedVersion, useIpasChanged } from "../../../components/ipas/record/useIpasChanged";
import { useSectionsOpen } from "../../../components/ipas/record/useSectionsOpen";
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
import IpasStatusControl from "../../../components/ipas/IpasStatusControl";
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
  IPAS_TICK_SIDE,
  IPAS_SUPPLIER_ORIGIN_FIELDS,
  IPAS_TYPED_STATUS,
  IPAS_TYPED_STATUS_LABELS,
  IPAS_UNDO_APPROVAL_SECTIONS,
  ipasSectionLabel,
  ipasSectionNo,
  ipasSectionWord,
} from "../../../constants/ipas";

const HEADER_LABELS = {
  [IPAS_HEADER_FIELD.SUPPLIER_CONTACT]: "Supplier's name",
  [IPAS_HEADER_FIELD.PI_NUMBER]: "P.I #",
  [IPAS_HEADER_FIELD.PI_QT_AMOUNT]: "P.I/QT Amount",
  [IPAS_HEADER_FIELD.REMARKS]: "Remarks",
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
    case IPAS_HEADER_FIELD.REMARKS:
      return ipas.remarks ?? "";
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
 * #247 adds the sign-offs of sections 1 and 3 at the foot of each: Submitted
 * (Purchasing access), Approved (the section's list, never the submitter) and
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
  // Counts the long form's successful saves, so it can clear what it holds when a Retry finishes the job.
  const [savedCount, setSavedCount] = useState(0);
  const [removing, setRemoving] = useState(null); // { type: "payment" | "charge", row }
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [overriding, setOverriding] = useState(null);
  const [typing, setTyping] = useState(null);
  const [removingDocument, setRemovingDocument] = useState(null);
  // The typed dates being edited: "origin" (Supplier Origin) or a typed status key.
  const [dates, setDates] = useState(null);
  // Which section blocks are open (several can be; ?open= names one on arrival), and each block's
  // header, so focus can go back to it.
  const sections = useSectionsOpen();
  // The section in the edit view (?edit=), and the section last left, to focus its block on the way back.
  const { key: editKey, edit: openEdit, leave: leaveEdit } = useEditSection();
  const editedKey = useRef(null);
  const rowEls = useRef({});
  // Back from the edit view lands on that section, open, where it was edited from.
  const backToPreview = () => leaveEdit(editKey);

  // The stored copy, at once. The refresh below catches it up.
  const { data: ipas, isLoading, isError, refetch } = useQuery({
    queryKey: ipasKey(id),
    queryFn: () => ipasService.get(id, { refresh: false }),
    enabled: Boolean(id),
  });

  // Edit-form guard (#581): the newest event the form loaded, checked on Save all; and the
  // notice when somebody else changes this IPAS while the form is open.
  const versionRef = useRef(null);
  versionRef.current = loadedVersion(ipas);
  const { by: changedBy, dismiss: dismissChanged } = useIpasChanged({ id, userId: user?.id, active: Boolean(editKey && ipas) });
  const reloadChanged = async () => {
    await refetch();
    dismissChanged();
  };

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

  // Leaving the edit view (its link, or Back) returns to the overview with that section's header focused.
  useEffect(() => {
    if (editKey) {
      editedKey.current = editKey;
      return;
    }
    const from = editedKey.current;
    if (!from) return;
    editedKey.current = null;
    rowEls.current[from]?.focus();
  }, [editKey]);

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
            ? `Section ${ipasSectionLabel(section)} submitted. The approvers were told.`
            : `Section ${ipasSectionLabel(section)} submitted. Nobody is on its approval list yet.`,
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
        toast.success(`Section ${ipasSectionLabel(section)} returned to its submitter.`);
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
        remarks: field === IPAS_HEADER_FIELD.REMARKS ? value : undefined,
      }),
    onMutate: ({ field, value }) => ({
      rollback: patchCache(
        optimistic.setRow(
          optimistic.headerColumns({
            supplierContact: field === IPAS_HEADER_FIELD.SUPPLIER_CONTACT ? value : undefined,
            piNumber: field === IPAS_HEADER_FIELD.PI_NUMBER ? value : undefined,
            piQtAmount: field === IPAS_HEADER_FIELD.PI_QT_AMOUNT ? value : undefined,
            remarks: field === IPAS_HEADER_FIELD.REMARKS ? value : undefined,
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

  // The long edit form's one Save (#581): every typed change goes in together, in order (the
  // header and statuses, then payments, charges, documents, bank details and, last, the
  // computation status), and the page re-reads once at the end. The first failure stops the
  // rest and is kept with Retry; what was typed stays in the form. Rows already stored are
  // remembered on the plan (`plan.done`), so a Retry never adds a payment twice.
  const saveAll = useMutation({
    mutationFn: async (plan) => {
      const once = async (key, run) => {
        if (plan.done.has(key)) return;
        await run();
        plan.done.add(key);
      };
      try {
        // Before the first write only: later steps would trip over this save's own events.
        if (!plan.checked) {
          await ipasService.assertUnchanged(id, versionRef.current);
          plan.checked = true;
        }
        for (const item of plan.overrides) {
          if (item.reset) await ipasService.resetOverride(id, item.field);
          else await ipasService.overrideField(id, item.field, item.value);
        }
        if (Object.keys(plan.header).length > 0) await ipasService.setHeader(id, plan.header);
        if (plan.location !== undefined) await ipasService.setItemLocation(id, plan.location);
        if (Object.keys(plan.origin).length > 0) await ipasService.setSupplierOrigin(id, plan.origin);
        for (const item of plan.typed) await ipasService.setTypedStatus(id, item.kind, item.date);
        if (plan.stamp !== undefined) await ipasService.stampActualChecking(id, { stamped: plan.stamp });
        const { isPhpPo } = plan.payments;
        for (const item of plan.payments.add) await once(item.key, () => ipasService.addPayment(id, item.values, { isPhpPo }));
        for (const item of plan.payments.update) await once(item.key, () => ipasService.updatePayment(item.id, item.values, { isPhpPo }));
        for (const item of plan.charges.add) await once(item.key, () => ipasService.addCharge(id, item.values));
        for (const item of plan.charges.update) await once(item.key, () => ipasService.updateCharge(item.id, item.values));
        for (const item of plan.documents.add) await once(item.key, () => ipasService.addDocument(id, item.choice));
        for (const item of plan.documents.update) {
          await once(item.key, async () => {
            if (item.attachmentUrl !== undefined) await ipasService.setDocument(item.id, { attachmentUrl: item.attachmentUrl });
            if (item.purchasing !== undefined) await ipasService.tickDocument(item.id, IPAS_TICK_SIDE.PURCHASING, item.purchasing);
            if (item.finance !== undefined) await ipasService.tickDocument(item.id, IPAS_TICK_SIDE.FINANCE, item.finance);
          });
        }
        if (plan.bank) {
          await once("bank", async () => {
            const result = await ipasService.setBankDetails(id, plan.bank);
            if (result.flagged && result.accountChanged) {
              toast.error(`Account # differs from this supplier's last IPAS. It is flagged and its ${ipasSectionWord(3)} approval was cleared.`, {
                duration: 8000,
              });
            }
          });
        }
        if (plan.status !== undefined) await ipasService.setHeader(id, { computationStatus: plan.status });
      } catch (error) {
        // Tells the form which rows are stored already, so they leave it.
        if (error && typeof error === "object") error.doneKeys = [...plan.done];
        throw error;
      } finally {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ipasKey(id) }),
          queryClient.invalidateQueries({ queryKey: ipasListKey }),
          plan.done.has("bank") ? queryClient.invalidateQueries({ queryKey: ipasPendingPrefix }) : null,
        ]);
      }
    },
    onSuccess: () => {
      setChangeFailure(null);
      setSavedCount((count) => count + 1);
      toast.success("Saved.");
    },
    onError: (error, plan) => failChange(error, () => saveAll.mutate(plan)),
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
    // Printing refreshes from Odoo and may write events; reload so the form's version is current (#585).
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ipasKey(id) });
      queryClient.invalidateQueries({ queryKey: ipasListKey });
    },
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
  const digest = digestIpas(ipas);

  // The sign-offs of sections 1, 2 and 3 (stored 1, 3 and 6): what this person may do on each.
  const sectionRights = (section) =>
    signoffRights({
      section,
      sectionState: ipas.signoffSections[section],
      userId: user?.id,
      hasPurchasingFlow,
      lists: signerLists,
      ipasState: ipas.state,
      computationStatus: ipas.computationStatus,
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
  const returnTargets = IPAS_UNDO_APPROVAL_SECTIONS
    .filter((section) => sectionRights(section).returnMode)
    .map((section) => {
      const undo = sectionRights(section).returnMode === "undo";
      return {
        section,
        mode: undo ? "undo" : "return",
        no: ipasSectionNo(section),
        label: ipasSectionLabel(section),
        effect: undo
          ? "Takes back the approval only. Submitted stays, so it waits for an approver again."
          : "Clears Submitted and Approved and tells whoever submitted it.",
        clears: filingGiven.map((line) => `${ipasSectionLabel(7)}: ${line}`),
      };
    });
  if (canReturnSection7) {
    returnTargets.push({
      section: 7,
      mode: "return",
      no: ipasSectionNo(7),
      label: ipasSectionLabel(7),
      effect: `Clears Received, Noted and Checked and tells who gave them. Sections ${ipasSectionLabel(1)}, ${ipasSectionLabel(3)} and ${ipasSectionLabel(6)} stay approved.`,
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
    // The one page-level Edit: opens the long edit form at its first section (#581).
    edit: () => openEdit("header"),
    editPurpose: () => setEditing(true),
    cancel: () => setCancelling(true),
    reopen: () => setReopening(true),
    editOverride: setOverriding,
    resetOverride: (field) => reset.mutate(field),
    editHeader: setTyping,
    editAmount: () => setTyping(IPAS_HEADER_FIELD.PI_QT_AMOUNT),
    pickFreight: (optionId) => pick.mutate({ freightServiceId: optionId }),
    removePayment: (payment) => setRemoving({ type: "payment", row: payment }),
    tickSheet: (field, value) => tickSheet.mutate({ field, value }),
    removeCharge: (charge) => setRemoving({ type: "charge", row: charge }),
    tickDocument: (document, side, value) => tick.mutate({ document, side, value }),
    // attach's onError has already toasted the reason; the catch keeps the rejection from escaping.
    attach: (document, url) => attach.mutateAsync({ document, url }).catch(() => {}),
    removeAttachment: (document) => attach.mutate({ document, url: "" }),
    suggestDocuments: () => suggest.mutate(),
    removeDocument: setRemovingDocument,
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
      // Only Purchasing moves the Computation status; section 3's sign-off is the check.
      setStatus: (from, to) => open && canSetComputationStatus({ from, to, hasPurchasingFlow }),
      reopen: isSuperAdmin && filed,
      printFiling: filed && ipas.canReadBankDetails,
    },
    rights: { 1: sectionRights(1), 3: sectionRights(3), 6: sectionRights(6), 7: filingRights, sendBack7: canReturnSection7 },
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
  // The long edit form (#581). The money is typed in its cards; only the sign-offs and the
  // filing checklist reuse the section bodies.
  const editView = editKey ? (
    <EditForm
      ipas={ipas}
      blocks={blocks}
      can={ctx.can}
      canSave={canChange || canRecord || canTickFinance}
      savedCount={savedCount}
      onRemoveSaved={(type, row) => setRemoving({ type, row })}
      onRemoveDocument={setRemovingDocument}
      onSuggest={() => suggest.mutate()}
      focusKey={editKey}
      saving={saveAll.isPending}
      onSave={(plan) => saveAll.mutateAsync(plan)}
      onBack={backToPreview}
      onEditPurpose={canChange && !ipas.sors?.length ? on.editPurpose : null}
      notice={
        changedBy && (
          <div role="status" className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-amber-a5 bg-amber-3 px-3 py-2 text-sm text-amber-11">
            <span>{changedBy} updated this IPAS. Reload to see the changes.</span>
            <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={reloadChanged}>
              Reload
            </Button>
          </div>
        )
      }
      failure={
        shownFailure && (
          <InlineError message={shownFailure.message} onRetry={shownFailure.retry} onDismiss={() => setChangeFailure(null)} />
        )
      }
    />
  ) : null;

  // The dialog closes on a failure too (its onConfirm catches): the failure then
  // shows inline at the move that started it, with Retry.
  return (
    <>
      <PageShell
        title={ipas.number}
        description={[ipas.po_number, ipas.supplier].filter(Boolean).join(" · ")}
        action={
          <>
            {/* The IPAS Status (#597): the list's pill, read from the same IPAS figures so the two never disagree. */}
            <div className="flex flex-wrap items-center gap-2 empty:hidden" data-testid="ipas-record-status">
              <IpasStatusControl ipas={ipas} figures={digest.figures} canSet={hasPurchasingFlow || hasFinanceFlow} />
              {digest.figures.onHoldNote && (
                <span className="text-xs text-muted-foreground" data-testid="ipas-record-on-hold-note">
                  {digest.figures.onHoldNote}
                </span>
              )}
            </div>
            <HeaderActions ctx={ctx} />
          </>
        }
      >
        {open && (hasPurchasingFlow || isSuperAdmin) && (
          <p className="mb-4 text-xs text-muted-foreground" data-testid="ipas-wrong-po-hint">
            Wrong PO? Cancel this IPAS and raise a new one.
          </p>
        )}
        <div className="space-y-6">
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

          {/* Top to bottom: the decision card, the money, then every section as a block that opens in place. */}
          {editView ?? (
            <div className="min-w-0 space-y-8">
              <DecisionCard ctx={ctx} digest={digest} onReview={sections.show} next={nextIpas} />
              {/* The money summary (#603): Supplier bill check, Paid, Remaining balance, Landed Cost. */}
              <div data-testid="ipas-money-summary-slot">
                <MoneySummary digest={digest} onOpen={sections.show} />
              </div>
              <SectionsPanel
                ctx={ctx}
                blocks={blocks}
                digest={digest}
                open={sections}
                headRef={(key) => (node) => {
                  rowEls.current[key] = node;
                }}
                onEdit={openEdit}
              />
            </div>
          )}
        </div>
      </PageShell>

      <EditPurposeSorsDialog ipas={ipas} open={editing} onOpenChange={setEditing} />

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
        description={`It returns to open and the sign-offs of section ${ipasSectionLabel(7)} are cleared (the history keeps them). Sections ${ipasSectionLabel(1)}, ${ipasSectionLabel(3)} and ${ipasSectionLabel(6)} stay approved. Filing it again takes section ${ipasSectionLabel(7)} from Received.`}
        placeholder="Why is this filed IPAS being reopened?"
        submitLabel="Reopen"
        busyLabel="Reopening…"
        inlineError
        onSubmit={(reason) => reopen.mutateAsync(reason)}
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
        description={
          typing === IPAS_HEADER_FIELD.REMARKS
            ? "Kept in the IPAS history. Remarks are fixed once the IPAS is filed."
            : "What you type is kept; Odoo fills this only while it is blank."
        }
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
