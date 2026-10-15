import { useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowLeft, Pencil, Printer, Send, XCircle } from "lucide-react";
import { openTransmittalPrintWindow, printTransmittal } from "../../../lib/pdf/transmittalPrinter";

import ProtectedRoute from "../../../components/ProtectedRoute";
import { Button } from "../../../components/ui/button";
import PageShell from "../../../components/ui/PageShell";
import PageLoading from "../../../components/ui/PageLoading";
import EmptyState from "../../../components/ui/EmptyState";
import QueryError from "../../../components/ui/QueryError";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { FieldBox } from "../../../components/ui/FieldBox";
import { Textarea } from "../../../components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import StatusBadge from "../../../components/StatusBadge";
import TransmittalForm from "../../../components/transmittals/TransmittalForm";
import { CheckBySection } from "../../../components/transmittals/CheckBySection";
import {
  OdooReceiptSection,
  WarehouseRatings,
  WarehouseStageSignoff,
} from "../../../components/transmittals/WarehouseStages";
import { transmittalKeys } from "../../../components/transmittals/transmittalKeys";
import { useAuth } from "../../../context/AuthContext";
import { getPermissionContext } from "../../../utils/permissions";
import { transmittalService } from "../../../services/transmittalService";
import { stagesOf, transmittalStateLabel } from "../../../utils/transmittals";
import {
  TRANSMITTAL_ORIGIN_LABELS,
  TRANSMITTAL_PRIORITY_LABELS,
  TRANSMITTAL_RATING_LABELS,
  TRANSMITTAL_STAFF_LIST,
  TRANSMITTAL_STAGE,
  TRANSMITTAL_STATE,
} from "../../../constants/transmittals";

/**
 * One Transmittal (#252, #253, #254): its header as on the paper, its lines, its
 * stages, Received in Odoo and the Check by plates. A draft can be edited and
 * submitted by its preparer or Purchasing; a slip with no signed stage can be
 * cancelled with a reason. The Warehouse rates and signs its stages (#253);
 * Technical rates and inspects (#254), then Check by signs the slip closed.
 */

const STAGE_LABEL = {
  [TRANSMITTAL_STAGE.WAREHOUSE_CHECKING]: "Warehouse checking",
  [TRANSMITTAL_STAGE.WAREHOUSE_RELEASING]: "Warehouse releasing",
  [TRANSMITTAL_STAGE.TECHNICAL_INSPECTION]: "Technical inspection",
};

const ENDED = [TRANSMITTAL_STATE.CLOSED, TRANSMITTAL_STATE.CANCELLED];

function TransmittalPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { hasPurchasingFlow, isSuperAdmin } = getPermissionContext(user);

  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

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

  if (isLoading) return <PageLoading label="Transmittal" />;
  if (isError) return <QueryError title="The Transmittal could not be loaded." onRetry={refetch} />;
  if (!transmittal) {
    return (
      <EmptyState
        title="No such Transmittal"
        description="It may not exist, or you can't read it."
      />
    );
  }

  const t = transmittal;
  const isPreparer = t.preparedById === user?.id;
  const canChange = isPreparer || hasPurchasingFlow || isSuperAdmin;
  const onWarehouse = myLists.includes(TRANSMITTAL_STAFF_LIST.WAREHOUSE);
  const isOpen = !ENDED.includes(t.state) && t.state !== TRANSMITTAL_STATE.DRAFT;
  const canRate = onWarehouse && t.state === TRANSMITTAL_STATE.WAREHOUSE_CHECKING;
  const canSignChecking = onWarehouse && t.state === TRANSMITTAL_STATE.WAREHOUSE_CHECKING;
  // Releasing is signed in its state on a Warehouse + Technical slip; on a
  // Warehouse-only slip it is optional and signable until the slip closes.
  const canSignReleasing =
    onWarehouse &&
    (t.checkTechnical ? t.state === TRANSMITTAL_STATE.WAREHOUSE_RELEASING : isOpen);
  const showReleasing = stagesOf(t).includes(TRANSMITTAL_STAGE.WAREHOUSE_RELEASING) || (t.checkWarehouse && !t.checkTechnical && isOpen);
  const onTechnical = myLists.includes(TRANSMITTAL_STAFF_LIST.TECHNICAL);
  const onCheckBy = myLists.includes(TRANSMITTAL_STAFF_LIST.CHECK_BY);
  const canRateTech = onTechnical && t.state === TRANSMITTAL_STATE.TECHNICAL_INSPECTION;
  const canSignTech = canRateTech;
  const showTechnical = stagesOf(t).includes(TRANSMITTAL_STAGE.TECHNICAL_INSPECTION);
  const canCheck = onCheckBy;
  const canRecordOdoo =
    (onWarehouse || hasPurchasingFlow || isSuperAdmin) && isOpen && !t.odooReceivedAt;
  const members = { warehouse: warehouseMembers, technical: technicalMembers };
  const isDraft = t.state === TRANSMITTAL_STATE.DRAFT;
  const canCancel = !ENDED.includes(t.state) && !t.stages.some((s) => s.completed_at) && canChange;

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: transmittalKeys.all });
  };

  const submit = async () => {
    setBusy(true);
    try {
      const done = await transmittalService.submit(t.id);
      toast.success(`${done.number} submitted.`);
      refresh();
    } catch (error) {
      toast.error(error.message || "The Transmittal could not be submitted.");
    } finally {
      setBusy(false);
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
      toast.error(error.message || "The Transmittal could not be cancelled.");
    } finally {
      setBusy(false);
    }
  };

  // A slip prints once submitted: any stage, awaiting Check by, or closed. Not a draft, not cancelled.
  const canPrint = t.state !== TRANSMITTAL_STATE.DRAFT && t.state !== TRANSMITTAL_STATE.CANCELLED;

  const printTransmittalForm = async () => {
    const printWindow = openTransmittalPrintWindow();
    if (!printWindow) {
      toast.error("Popup blocked. Allow popups to print.");
      return;
    }
    try {
      await printTransmittal(id, { printWindow });
    } catch (error) {
      toast.error(error.message || "The Transmittal could not be printed.");
    }
  };

  const stages = stagesOf(t);

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
          {canPrint && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={printTransmittalForm}>
              <Printer size={14} />
              Print
            </Button>
          )}
          {isDraft && canChange && !editing && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEditing(true)}>
              <Pencil size={14} />
              Edit
            </Button>
          )}
          {isDraft && canChange && (
            <Button size="sm" className="gap-1.5" disabled={busy || t.lines.length === 0} onClick={submit}>
              <Send size={14} />
              Submit
            </Button>
          )}
          {canCancel && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setCancelling(true)}>
              <XCircle size={14} />
              Cancel
            </Button>
          )}
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
        <TransmittalForm existing={t} onSaved={() => { setEditing(false); refresh(); }} onCancel={() => setEditing(false)} />
      ) : (
        <>
          <section className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-card p-4 text-[13px] sm:grid-cols-3">
            <Fact label="TG03" value={<span className="font-mono font-semibold">{t.number}</span>} />
            <Fact label="Prepared" value={`${t.preparedOn}${t.preparedBy ? ` · ${t.preparedBy.name}` : ""}`} />
            <Fact label="State" value={<StatusBadge theme="blue" label={transmittalStateLabel(t.state)} />} />
            <Fact label="Origin" value={t.origin === "other" ? `Others: ${t.originOther ?? ""}` : TRANSMITTAL_ORIGIN_LABELS[t.origin]} />
            <Fact
              label="Checking"
              value={[t.checkWarehouse && "Warehouse", t.checkTechnical && "TCA Technical", t.checkOther].filter(Boolean).join(" · ")}
            />
            <Fact label="Priority" value={TRANSMITTAL_PRIORITY_LABELS[t.priority] ?? t.priority} />
            <Fact label="Company" value={t.entity} />
            <Fact label="Product" value={[...t.products.map((p) => p.label), t.productOther].filter(Boolean).join(", ") || "—"} />
            <Fact
              label="Reference Checklist"
              value={t.references.map((r) => r.label).join(", ") || "—"}
            />
            <Fact label="Item Location" value={t.itemLocation?.label ?? "—"} />
            <Fact label="IPAS" value={t.ipasNumbers.join(", ") || "—"} />
          </section>

          <section className="space-y-2">
            <p className="text-sm font-semibold">Lines</p>
            {t.lines.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">No lines.</p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="overflow-x-auto">
                  <Table tableId="transmittal-lines" className="md:min-w-[48rem]">
                    <TableHeader>
                      <TableRow className="bg-muted/40 hover:bg-muted/40">
                        {["#", "Item", "PO", "Project Name (S.O)", "Quantity", "SN#", "Quantity of Box", "Whs GC/NA", "TCA GC/NA"].map((h) => (
                          <TableHead key={h} className="text-label font-bold uppercase tracking-wider">
                            {h}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {t.lines.map((line) => (
                        <TableRow key={line.id}>
                          <TableCell>{line.position}</TableCell>
                          <TableCell>{line.description}</TableCell>
                          <TableCell>{line.poNumber ?? "Typed"}</TableCell>
                          <TableCell>{line.sor?.salesReference ?? "—"}</TableCell>
                          <TableCell>
                            {line.quantity} {line.unit ?? ""}
                          </TableCell>
                          <TableCell>{line.serialNumbers || "—"}</TableCell>
                          <TableCell>{line.boxQuantity || "—"}</TableCell>
                          <TableCell>{TRANSMITTAL_RATING_LABELS[line.whRating] ?? "—"}</TableCell>
                          <TableCell>{TRANSMITTAL_RATING_LABELS[line.techRating] ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </section>

          <section className="space-y-2">
            <p className="text-sm font-semibold">Stages</p>
            {stages.length === 0 ? (
              <p className="text-[13px] text-muted-foreground">Opens when the slip is submitted.</p>
            ) : (
              <ul className="space-y-1 text-[13px]">
                {stages.map((stage) => {
                  const row = t.stages.find((s) => s.stage === stage);
                  return (
                    <li key={stage} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                      <span>{STAGE_LABEL[stage]}</span>
                      <span className="text-muted-foreground">
                        {row?.completed_at ? "Signed" : t.state === stage ? "Waiting" : "Not yet"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {stages.includes(TRANSMITTAL_STAGE.WAREHOUSE_CHECKING) && (
            <section className="space-y-3">
              <p className="text-sm font-semibold">Warehouse checking</p>
              {canRate ? (
                <WarehouseRatings transmittal={t} canRate onSaved={refresh} />
              ) : (
                <p className="text-[13px] text-muted-foreground">
                  Lines are rated GC or NA by the Warehouse while checking is open.
                </p>
              )}
              <WarehouseStageSignoff
                transmittal={t}
                stage={TRANSMITTAL_STAGE.WAREHOUSE_CHECKING}
                canSign={canSignChecking}
                currentUserId={user?.id}
                members={members}
                onChanged={refresh}
              />
            </section>
          )}

          {showReleasing && (
            <section className="space-y-3">
              <WarehouseStageSignoff
                transmittal={t}
                stage={TRANSMITTAL_STAGE.WAREHOUSE_RELEASING}
                canSign={canSignReleasing}
                currentUserId={user?.id}
                members={members}
                onChanged={refresh}
              />
            </section>
          )}

          {showTechnical && (
            <section className="space-y-3">
              <p className="text-sm font-semibold">Technical inspection</p>
              {canRateTech ? (
                <WarehouseRatings transmittal={t} canRate technical onSaved={refresh} />
              ) : (
                <p className="text-[13px] text-muted-foreground">
                  Lines are rated GC or NA by Technical while inspection is open.
                </p>
              )}
              <WarehouseStageSignoff
                transmittal={t}
                stage={TRANSMITTAL_STAGE.TECHNICAL_INSPECTION}
                canSign={canSignTech}
                currentUserId={user?.id}
                members={members}
                onChanged={refresh}
              />
            </section>
          )}

          <CheckBySection transmittal={t} canCheck={canCheck} currentUserId={user?.id} onChanged={refresh} />

          {(t.checkWarehouse || t.stages.length > 0) && (
            <section>
              <OdooReceiptSection transmittal={t} canRecord={canRecordOdoo} onRecorded={refresh} />
            </section>
          )}
        </>
      )}

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

function Fact({ label, value }) {
  return (
    <div className="space-y-0.5">
      <p className="text-label font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
      <div>{value}</div>
    </div>
  );
}

export default function TransmittalDetailPage() {
  return (
    <ProtectedRoute>
      <TransmittalPage />
    </ProtectedRoute>
  );
}
