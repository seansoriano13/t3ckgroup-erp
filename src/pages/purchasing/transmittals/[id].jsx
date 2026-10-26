import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Pencil, Printer, XCircle } from "lucide-react";

import ProtectedRoute from "../../../components/ProtectedRoute";
import { Button } from "../../../components/ui/button";
import ModalShell from "../../../components/ui/ModalShell";
import PageLoading from "../../../components/ui/PageLoading";
import EmptyState from "../../../components/ui/EmptyState";
import QueryError from "../../../components/ui/QueryError";
import { FieldBox } from "../../../components/ui/FieldBox";
import { Textarea } from "../../../components/ui/textarea";
import RecordMoreMenu from "../../../components/record/RecordMoreMenu";
import TransmittalDesk from "../../../components/transmittals/record/TransmittalDesk";
import TransmittalForm from "../../../components/transmittals/TransmittalForm";
import { transmittalKeys } from "../../../components/transmittals/transmittalKeys";
import {
  CheckByBody,
  DetailsBody,
  LinesBody,
  OdooBody,
  StageBody,
} from "../../../components/transmittals/record/SectionBodies";
import { EMPTY_STAGE_FORM, choosesSlot, movesFor } from "../../../components/transmittals/record/transmittalMoves";
import {
  SECTION,
  STAGE_TITLE,
  gatesOf,
  rightsOf,
  statusLine,
  summariesOf,
} from "../../../components/transmittals/record/transmittalRecord";
import { useAuth } from "../../../context/AuthContext";
import { getPermissionContext } from "../../../utils/permissions";
import { transmittalService } from "../../../services/transmittalService";
import { stagesOf } from "../../../utils/transmittals";
import { openTransmittalPrintWindow, printTransmittal } from "../../../lib/pdf/transmittalPrinter";
import { openTsrPrintWindow, printTsr } from "../../../lib/pdf/tsrPrinter";
import {
  TRANSMITTAL_STAFF_LIST,
  TRANSMITTAL_STAGE,
  TRANSMITTAL_STATE,
} from "../../../constants/transmittals";
import { ipasErrorMessage } from "../../../utils/ipas";
import TransmittalsListPage from "./index";

const LIST_PATH = "/purchasing/transmittals";

/**
 * One Transmittal in the record window over the Transmittals list: the shared
 * record header and pills, its lines as a liner list, and the shared "Your move"
 * card. Signing happens in the card's steps, which open in place; a step's body
 * shows who signed and when, and holds the data entry (ratings, pictures,
 * remarks, who the other signatory is). Who may sign, and in what order, is the
 * database's rule (#252 to #254); the screen only offers what it will accept.
 */

function TransmittalPage({ onClose }) {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { hasPurchasingFlow } = getPermissionContext(user);

  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  // The signature being undone: { kind, stage?, slot?, label, from }; its reason is asked in a dialog.
  const [undoing, setUndoing] = useState(null);
  const [undoReason, setUndoReason] = useState("");
  const [busy, setBusy] = useState(false);
  // The sign form of each stage and the Odoo receipt reference: the card's move and the drawer's bar read the same fields.
  const [forms, setForms] = useState({});
  const [odooRef, setOdooRef] = useState("");
  const [failure, setFailure] = useState(null);

  const { data: transmittal, isLoading, isError, refetch } = useQuery({
    queryKey: transmittalKeys.detail(id),
    queryFn: async () => transmittalService.get(id),
    enabled: Boolean(id),
  });

  // The caller's own Transmittal staff lists, and the names on the two lists
  // the signatory pickers need. A failure reads as "not on it"; the database
  // still refuses.
  const { data: myLists = [] } = useQuery({
    queryKey: [...transmittalKeys.detail(id), "my-lists", user?.id],
    queryFn: () => transmittalService.myStaffLists(user?.id),
    enabled: Boolean(id && user?.id),
  });
  const { data: warehouseMembers = [] } = useQuery({
    queryKey: [...transmittalKeys.detail(id), "members", TRANSMITTAL_STAFF_LIST.WAREHOUSE],
    queryFn: () => transmittalService.stageListMembers(id, TRANSMITTAL_STAFF_LIST.WAREHOUSE),
    enabled: Boolean(id),
  });
  const { data: technicalMembers = [] } = useQuery({
    queryKey: [...transmittalKeys.detail(id), "members", TRANSMITTAL_STAFF_LIST.TECHNICAL],
    queryFn: () => transmittalService.stageListMembers(id, TRANSMITTAL_STAFF_LIST.TECHNICAL),
    enabled: Boolean(id),
  });
  // The existing Check by queue (Approval Center): where "next waiting on me" comes from.
  const onCheckByList = myLists.includes(TRANSMITTAL_STAFF_LIST.CHECK_BY);
  const { data: checkByQueue = [] } = useQuery({
    queryKey: ["transmittalCheckByQueue", user?.id],
    queryFn: () => transmittalService.list({ state: TRANSMITTAL_STATE.AWAITING_CHECK }),
    enabled: Boolean(user?.id && onCheckByList),
  });


  if (isLoading || isError || !transmittal) {
    return (
      <ModalShell open onOpenChange={(next) => !next && onClose()} size="record" crumbs={["Transmittal"]}>
        {isLoading ? (
          <PageLoading label="Transmittal" />
        ) : isError ? (
          <QueryError title="The Transmittal could not be loaded." onRetry={refetch} />
        ) : (
          <EmptyState title="No such Transmittal" description="It may not exist, or you can't read it." />
        )}
      </ModalShell>
    );
  }

  const t = transmittal;
  const rights = rightsOf(t, { userId: user?.id, lists: myLists, hasPurchasingFlow });
  const gates = gatesOf(t);
  const members = { warehouse: warehouseMembers, technical: technicalMembers };
  const stageForm = (stage) => forms[stage] ?? EMPTY_STAGE_FORM;
  const setStageForm = (stage, patch) =>
    setForms((prev) => ({ ...prev, [stage]: { ...EMPTY_STAGE_FORM, ...prev[stage], ...patch } }));

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: transmittalKeys.all });
    queryClient.invalidateQueries({ queryKey: ["transmittalCheckByQueue"] });
  };

  // Runs one move: busy while it runs, a toast either way, and on a failure the message shows inline
  // where the move was started, with Retry (the same call again).
  const perform = async (from, action, { success, error: errorText }) => {
    setBusy(true);
    try {
      const result = await action();
      setFailure(null);
      if (success) toast.success(success(result));
      refresh();
    } catch (error) {
      const message = ipasErrorMessage(error, errorText);
      toast.error(message);
      if (from) {
        setFailure({
          key: from.key,
          origin: from.origin,
          message,
          retry: () => perform(from, action, { success, error: errorText }),
          dismiss: () => setFailure(null),
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const on = {
    submit: (from) =>
      perform(from, () => transmittalService.submit(t.id), {
        success: (done) => `${done.number} submitted.`,
        error: "The Transmittal could not be submitted.",
      }),
    signStage: (stage, form, from) =>
      perform(
        from,
        async () => {
          const result = await transmittalService.completeStage(t.id, {
            stage,
            otherSignerId: form.otherId || null,
            otherSignerName: form.otherId ? null : form.otherName.trim() || null,
            remarks: form.remarks.trim() || null,
            noPicturesReason: form.noPicturesReason.trim() || null,
            signAsSecond: choosesSlot(stage) && form.signAsSecond,
          });
          setForms((prev) => ({ ...prev, [stage]: undefined }));
          return result;
        },
        { success: () => `${STAGE_TITLE[stage]} signed.`, error: "The stage could not be signed." },
      ),
    confirmStage: (stageId, value, from) =>
      perform(from, () => transmittalService.confirmSignature(stageId, value), {
        success: () => (value ? "Signature confirmed." : "Signature declined."),
        error: "The signature could not be updated.",
      }),
    recordOdoo: (ref, from) =>
      perform(from, () => transmittalService.receivedInOdoo(t.id, ref), {
        success: () => "Received in Odoo recorded.",
        error: "The Odoo receipt could not be recorded.",
      }),
    askUndo: (target, from) => {
      setUndoReason("");
      setUndoing({ ...target, from });
    },
    checkBy: (slot, from) =>
      perform(from, () => transmittalService.checkBy(t.id, slot), {
        success: () => "Check by signed.",
        error: "The Check by could not be signed.",
      }),
  };

  const built = movesFor(t, rights, { forms, odooRef, on });
  const offered = [...built.moves, ...built.declines];
  const summaries = summariesOf(t, gates);

  // The next slip waiting on the viewer: the Check by queue's first other slip they did not prepare, once nothing is left for them here.
  const nextSlip =
    onCheckByList && !rights.checkBy.first && !rights.checkBy.second
      ? (checkByQueue.find((slip) => slip.id !== t.id && slip.preparedById !== user?.id) ?? null)
      : null;

  const restate = (section) => {
    if (section === SECTION.ODOO) return `Records that ${t.number} is received in Odoo.`;
    if (section === SECTION.CHECK_BY) return `Signs a Check by plate on ${t.number}.`;
    if (section === SECTION.DETAILS) return `Submits ${t.number}.`;
    return `Signs ${STAGE_TITLE[section] ?? section} on ${t.number}.`;
  };

  // A slip prints once submitted: any stage, awaiting Check by, or closed. Not a draft, not cancelled.
  const canPrint = t.state !== TRANSMITTAL_STATE.DRAFT && t.state !== TRANSMITTAL_STATE.CANCELLED;
  const hasTechnical = stagesOf(t).includes(TRANSMITTAL_STAGE.TECHNICAL_INSPECTION);

  const printTransmittalForm = async () => {
    const printWindow = openTransmittalPrintWindow();
    if (!printWindow) {
      toast.error("Popup blocked. Allow popups to print.");
      return;
    }
    try {
      await printTransmittal(id, { printWindow });
    } catch (error) {
      toast.error(ipasErrorMessage(error, "The Transmittal could not be printed."));
    }
  };

  // The TSR is the Technical inspection stage printed as a report (#259).
  const printTsrForm = async ({ withPhotographs = false } = {}) => {
    const printWindow = openTsrPrintWindow();
    if (!printWindow) {
      toast.error("Popup blocked. Allow popups to print.");
      return;
    }
    try {
      const tsr = await transmittalService.getTsr(id);
      if (!tsr) throw new Error("This Transmittal has no Technical inspection to report.");
      await printTsr(tsr, { printWindow, withPhotographs });
    } catch (error) {
      try {
        printWindow.close();
      } catch {
        // Already closed.
      }
      toast.error(ipasErrorMessage(error, "The TSR could not be printed."));
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await transmittalService.cancel(t.id, reason);
      toast.success(`${t.number} cancelled.`);
      setCancelling(false);
      setReason("");
      refresh();
    } catch (error) {
      toast.error(ipasErrorMessage(error, "The Transmittal could not be cancelled."));
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    const { kind, stage, slot, from } = undoing;
    setUndoing(null);
    await perform(
      from,
      () => transmittalService.undoSignature(t.id, { kind, stage, slot, reason: undoReason }),
      { success: () => "Signature undone.", error: "The signature could not be undone." },
    );
  };

  const menuItems = [];
  if (canPrint) {
    menuItems.push({ key: "print", label: "Print", icon: Printer, onSelect: printTransmittalForm });
    if (hasTechnical) {
      menuItems.push({ key: "tsr", label: "Print TSR", icon: Printer, onSelect: () => printTsrForm() });
      menuItems.push({
        key: "tsr-photos",
        label: "Print with photographs",
        icon: Printer,
        onSelect: () => printTsrForm({ withPhotographs: true }),
      });
    }
  }
  if (rights.canCancel) {
    menuItems.push({ key: "cancel", label: "Cancel", icon: XCircle, destructive: true, onSelect: () => setCancelling(true) });
  }

  const bodyOf = (section) => {
    if (section === SECTION.DETAILS) return <DetailsBody t={t} />;
    if (section === SECTION.LINES) return <LinesBody t={t} />;
    if (section === SECTION.ODOO) return <OdooBody t={t} rights={rights} odooRef={odooRef} setOdooRef={setOdooRef} />;
    if (section === SECTION.CHECK_BY) return <CheckByBody t={t} rights={rights} userId={user?.id} onChanged={refresh} />;
    return (
      <StageBody
        t={t}
        stage={section}
        rights={rights}
        form={stageForm(section)}
        setForm={setStageForm}
        members={members}
        userId={user?.id}
        onChanged={refresh}
      />
    );
  };

  const ctx = {
    t,
    rights,
    gates,
    summaries,
    built,
    members,
    user,
    busy,
    failure,
    refresh,
    restate,
    nextSlip,
    status: statusLine(t, gates, offered),
    bodyOf,
  };

  return (
    <ModalShell
      open
      onOpenChange={(next) => !next && onClose()}
      size="record"
      crumbs={["Transmittal", t.number]}
      headerActions={
        <>
          {rights.draft && rights.canChange && !editing && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil size={14} />
              Edit
            </Button>
          )}
          <RecordMoreMenu items={menuItems} />
        </>
      }
    >
      {t.state === TRANSMITTAL_STATE.CANCELLED && (
        <div role="status" className="rounded-lg border border-border bg-muted/40 p-3 text-[13px]">
          <p className="font-semibold">Cancelled</p>
          <p className="text-muted-foreground">{t.cancelReason}</p>
        </div>
      )}

      {editing ? (
        <TransmittalForm
          existing={t}
          onSaved={() => {
            setEditing(false);
            refresh();
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <TransmittalDesk ctx={ctx} />
      )}

      {undoing !== null && (
        <ModalShell
          open
          onOpenChange={(open) => !open && setUndoing(null)}
          crumbs={["Transmittal", t.number, `Undo ${undoing.label}`]}
          title={`Undo ${undoing.label}?`}
          cancelLabel="Keep it signed"
          actions={
            <Button variant="destructive" size="lg" onClick={undo} disabled={busy || undoReason.trim() === ""}>
              Undo signature
            </Button>
          }
        >
          <p className="text-sm text-muted-foreground">
            Undo {undoing.label}? The signature is cleared and kept as history, with your name and the reason. Ratings,
            remarks and pictures stay.
          </p>
          <FieldBox label="Reason" bare>
            <Textarea rows={3} value={undoReason} onChange={(e) => setUndoReason(e.target.value)} />
          </FieldBox>
        </ModalShell>
      )}

      {cancelling && (
        <ModalShell
          open
          onOpenChange={(open) => !open && setCancelling(false)}
          crumbs={["Transmittal", t.number, "Cancel"]}
          title={`Cancel ${t.number}?`}
          cancelLabel="Keep it"
          actions={
            <Button size="lg" onClick={cancel} disabled={busy || reason.trim() === ""}>
              Cancel Transmittal
            </Button>
          }
        >
          <p className="text-sm text-muted-foreground">Cancel {t.number}? The number is never reused. Give the reason.</p>
          <FieldBox label="Reason" bare>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FieldBox>
        </ModalShell>
      )}
    </ModalShell>
  );
}

export default function TransmittalDetailPage() {
  const navigate = useNavigate();
  // The record is a modal over its list; the URL keeps working as a deep link.
  return (
    <>
      <TransmittalsListPage />
      <ProtectedRoute>
        <TransmittalPage onClose={() => navigate(LIST_PATH)} />
      </ProtectedRoute>
    </>
  );
}
