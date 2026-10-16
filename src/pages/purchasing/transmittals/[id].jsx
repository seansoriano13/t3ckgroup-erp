import { useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowLeft, Pencil, Printer, XCircle } from "lucide-react";

import ProtectedRoute from "../../../components/ProtectedRoute";
import { Button } from "../../../components/ui/button";
import PageShell from "../../../components/ui/PageShell";
import PageLoading from "../../../components/ui/PageLoading";
import EmptyState from "../../../components/ui/EmptyState";
import QueryError from "../../../components/ui/QueryError";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { FieldBox } from "../../../components/ui/FieldBox";
import { Textarea } from "../../../components/ui/textarea";
import NumbersStrip from "../../../components/record/NumbersStrip";
import RecordCard from "../../../components/record/RecordCard";
import RecordDrawer from "../../../components/record/RecordDrawer";
import RecordMoreMenu from "../../../components/record/RecordMoreMenu";
import RecordRows from "../../../components/record/RecordRows";
import { useOpenSection } from "../../../components/record/useOpenSection";
import TransmittalForm from "../../../components/transmittals/TransmittalForm";
import { transmittalKeys } from "../../../components/transmittals/transmittalKeys";
import {
  CheckByBody,
  DetailsBody,
  LinesBody,
  OdooBody,
  StageBody,
} from "../../../components/transmittals/record/SectionBodies";
import { EMPTY_STAGE_FORM, choosesSlot, footerMovesFor, movesFor } from "../../../components/transmittals/record/transmittalMoves";
import {
  SECTION,
  STAGE_TITLE,
  gatesOf,
  numbersOf,
  rightsOf,
  sectionState,
  sectionsOf,
  statusLine,
  summariesOf,
} from "../../../components/transmittals/record/transmittalRecord";
import { useAuth } from "../../../context/AuthContext";
import { getPermissionContext } from "../../../utils/permissions";
import { transmittalService } from "../../../services/transmittalService";
import { stagesOf, transmittalStateLabel } from "../../../utils/transmittals";
import { openTransmittalPrintWindow, printTransmittal } from "../../../lib/pdf/transmittalPrinter";
import { openTsrPrintWindow, printTsr } from "../../../lib/pdf/tsrPrinter";
import {
  TRANSMITTAL_ORIGIN_LABELS,
  TRANSMITTAL_PRIORITY_LABELS,
  TRANSMITTAL_STAFF_LIST,
  TRANSMITTAL_STAGE,
  TRANSMITTAL_STATE,
} from "../../../constants/transmittals";
import { ipasErrorMessage } from "../../../utils/ipas";

/**
 * One Transmittal, laid out like the IPAS record page: the numbers strip, a
 * row per section that opens in a drawer, and the "Your move" card. Signing
 * happens only in the card or in the drawer's bottom bar; a section's body
 * shows who signed and when, and holds the data entry (ratings, pictures,
 * remarks, who the other signatory is). Who may sign, and in what order, is the
 * database's rule (#252 to #254); the screen only offers what it will accept.
 */

function TransmittalPage() {
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
  const rowEls = useRef({});

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

  const sections = transmittal ? sectionsOf(transmittal) : [];
  const { index, current, open: openSection, step, close } = useOpenSection({ drawerSections: sections });

  if (isLoading) return <PageLoading label="Transmittal" />;
  if (isError) return <QueryError title="The Transmittal could not be loaded." onRetry={refetch} />;
  if (!transmittal) {
    return <EmptyState title="No such Transmittal" description="It may not exist, or you can't read it." />;
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
    open: (key) => openSection(key),
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
  const numbers = numbersOf(t, gates);

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

  return (
    <PageShell
      title={t.number}
      description={`${transmittalStateLabel(t.state)} · ${TRANSMITTAL_ORIGIN_LABELS[t.origin] ?? t.origin} · ${TRANSMITTAL_PRIORITY_LABELS[t.priority] ?? t.priority} priority`}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" asChild className="gap-1.5">
            <Link to="/purchasing/transmittals">
              <ArrowLeft size={14} />
              Transmittals
            </Link>
          </Button>
          {rights.draft && rights.canChange && !editing && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditing(true)}>
              <Pencil size={14} />
              Edit
            </Button>
          )}
          <RecordMoreMenu items={menuItems} />
        </div>
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
        <div className="grid gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="min-w-0 space-y-8">
            <NumbersStrip
              stats={[
                { key: "lines", label: "Lines", value: numbers.lines, onOpen: () => openSection(SECTION.LINES) },
                { key: "gc", label: "GC", value: numbers.gc },
                { key: "na", label: "NA", value: numbers.na, tone: numbers.na > 0 ? "warning" : undefined },
                {
                  key: "steps",
                  label: "Steps done",
                  value: numbers.stepsTotal > 0 ? `${numbers.stepsDone} of ${numbers.stepsTotal}` : "—",
                },
              ]}
            />
            <RecordRows
              groups={[{ sections }]}
              stateOf={(key) => sectionState(key, t, gates)}
              summaryOf={(key) => summaries[key]}
              onOpen={openSection}
              rowRef={(key) => (node) => {
                rowEls.current[key] = node;
              }}
            />
          </div>
          <aside className="min-w-0 xl:sticky xl:top-2 xl:self-start">
            <RecordCard
              status={statusLine(t, gates, offered)}
              next={nextSlip && { to: `/purchasing/transmittals/${nextSlip.id}`, label: `Next Transmittal waiting for me: ${nextSlip.number}` }}
              groups={[
                { items: built.moves },
                { items: built.declines },
                { items: built.undos, className: "border-t border-border pt-4" },
              ]}
              gates={gates}
              restate={restate}
              reviewText={() => "Review section"}
              onReview={openSection}
              viewer={user?.name}
              busy={busy}
              failure={failure}
              chainLabel="Where it stands"
            />
          </aside>
        </div>
      )}

      {!editing && (
        <RecordDrawer
          number={t.number}
          sections={sections}
          current={current}
          index={index}
          step={step}
          close={close}
          getRow={(key) => rowEls.current[key]}
          onEdit={() => {}}
          body={current ? bodyOf(current.key) : null}
          summary={current ? (summaries[current.key] ?? "") : ""}
          moves={current ? footerMovesFor(built, current.key) : []}
          editable={false}
          restate={restate}
          viewer={user?.name}
          busy={busy}
          failure={failure}
        />
      )}

      <Dialog open={undoing !== null} onOpenChange={(open) => !open && setUndoing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="pr-10">
            <DialogTitle>Undo {undoing?.label}?</DialogTitle>
            <DialogDescription>
              The signature is cleared and kept as history, with your name and the reason. Ratings, remarks and
              pictures stay.
            </DialogDescription>
          </DialogHeader>
          <FieldBox label="Reason" bare>
            <Textarea rows={3} value={undoReason} onChange={(e) => setUndoReason(e.target.value)} />
          </FieldBox>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUndoing(null)}>
              Keep it signed
            </Button>
            <Button variant="destructive" onClick={undo} disabled={busy || undoReason.trim() === ""}>
              Undo signature
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelling} onOpenChange={setCancelling}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="pr-10">
            <DialogTitle>Cancel {t.number}?</DialogTitle>
            <DialogDescription>The number is never reused. Give the reason.</DialogDescription>
          </DialogHeader>
          <FieldBox label="Reason" bare>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </FieldBox>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelling(false)} disabled={busy}>
              Keep it
            </Button>
            <Button onClick={cancel} disabled={busy || reason.trim() === ""}>
              Cancel Transmittal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

export default function TransmittalDetailPage() {
  return (
    <ProtectedRoute>
      <TransmittalPage />
    </ProtectedRoute>
  );
}
