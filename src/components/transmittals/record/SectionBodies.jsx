// The bodies the Transmittal drawer shows, one per row. A body reads (who
// signed and when) and holds data entry (ratings, pictures, remarks, who the
// other signatory is, the Odoo receipt). It never signs: the signing buttons
// are the card's moves and the drawer's bottom bar.

import { useState } from "react";
import toast from "react-hot-toast";
import { ExternalLink, Trash2, Upload } from "lucide-react";

import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { FieldBox } from "@/components/ui/FieldBox";
import { FileInput } from "@/components/ui/FileInput";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/SelectField";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  TRANSMITTAL_ORIGIN_LABELS,
  TRANSMITTAL_PRIORITY_LABELS,
  TRANSMITTAL_RATING_LABELS,
  TRANSMITTAL_STAGE as STAGE,
} from "@/constants/transmittals";
import { transmittalService } from "@/services/transmittalService";
import { ipasErrorMessage } from "@/utils/ipas";
import { evidenceOf, stageRowOf, transmittalStateLabel } from "@/utils/transmittals";
import { formatPreparedAt } from "@/utils/preparedAt";
import { WarehouseRatings } from "../WarehouseRatings";
import { choosesSlot, picksOtherSigner, stageBlocker } from "./transmittalMoves";
import { STAGE_SIGNERS, STAGE_TITLE } from "./transmittalRecord";

const caption = "text-label font-bold uppercase tracking-wider text-muted-foreground";
const formatWhen = (value) => (value ? new Date(value).toLocaleString() : "");

function Fact({ label, value }) {
  return (
    <div className="space-y-0.5">
      <p className={caption}>{label}</p>
      <div>{value}</div>
    </div>
  );
}

/** "NA · Carl Aldrin Barojabo": the rating and who was in charge of it. */
function ratingWithInCharge(rating, inChargeName) {
  const label = TRANSMITTAL_RATING_LABELS[rating];
  if (!label) return "—";
  return inChargeName ? `${label} · ${inChargeName}` : label;
}

/**
 * Signatures that were undone in this section, kept as history: who had
 * signed and when, who cleared it and when, and why.
 */
function ClearedList({ entries }) {
  if (entries.length === 0) return null;
  return (
    <div className="space-y-2 border-t border-border pt-4 text-[13px]">
      <p className={caption}>Undone signatures</p>
      <ul className="space-y-2">
        {entries.map((entry) => (
          <li key={entry.id} className="rounded-lg border border-border p-3">
            <p>
              {entry.signerName ?? "Someone"}
              {entry.otherSignerName ? ` and ${entry.otherSignerName}` : ""} signed
              {entry.signedAt ? ` · ${formatWhen(entry.signedAt)}` : ""}
              {entry.receiptRef ? ` · ${entry.receiptRef}` : ""}
            </p>
            <p className="text-muted-foreground">
              Undone by {entry.clearedBy ?? "someone"} · {formatWhen(entry.clearedAt)}: {entry.reason}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The slip's header as on the paper, with its Reference Checklist. */
export function DetailsBody({ t }) {
  return (
    <section className="grid grid-cols-1 gap-4 text-[13px] sm:grid-cols-2">
      <Fact label="TG03" value={<span className="font-mono font-semibold">{t.number}</span>} />
      <Fact label="Prepared" value={`${formatPreparedAt(t.preparedOn)}${t.preparedBy ? ` · ${t.preparedBy.name}` : ""}`} />
      <Fact label="State" value={<StatusBadge theme="blue" label={transmittalStateLabel(t.state)} />} />
      <Fact
        label="Origin"
        value={t.origin === "other" ? `Others: ${t.originOther ?? ""}` : TRANSMITTAL_ORIGIN_LABELS[t.origin]}
      />
      <Fact
        label="Checking"
        value={[t.checkWarehouse && "Warehouse", t.checkTechnical && "TCA Technical", t.checkOther].filter(Boolean).join(" · ")}
      />
      <Fact label="Priority" value={TRANSMITTAL_PRIORITY_LABELS[t.priority] ?? t.priority} />
      <Fact label="Company" value={t.entity} />
      <Fact
        label="Product"
        value={[...t.products.map((p) => p.label), t.productOther].filter(Boolean).join(", ") || "—"}
      />
      <Fact label="Reference Checklist" value={t.references.map((r) => r.label).join(", ") || "—"} />
      <Fact label="Item Location" value={t.itemLocation?.label ?? "—"} />
      <Fact label="IPAS" value={t.ipasNumbers.join(", ") || "—"} />
    </section>
  );
}

/** The lines with their ratings. Read-only: ratings are entered in their stage. */
export function LinesBody({ t }) {
  if (t.lines.length === 0) return <p className="text-[13px] text-muted-foreground">No lines.</p>;
  return (
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
                  {line.quantityReceived != null && (
                    <span className="block text-xs text-muted-foreground">{line.quantityReceived} received</span>
                  )}
                </TableCell>
                <TableCell>{line.serialNumbers || "—"}</TableCell>
                <TableCell>{line.boxQuantity || "—"}</TableCell>
                <TableCell>
                  {ratingWithInCharge(line.whRating, line.whInChargeName)}
                  {line.whRemark && <span className="block text-xs text-muted-foreground">{line.whRemark}</span>}
                </TableCell>
                <TableCell>
                  {ratingWithInCharge(line.techRating, line.techInChargeName)}
                  {line.techRemark && <span className="block text-xs text-muted-foreground">{line.techRemark}</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/**
 * One stage: the ratings (data entry), its pictures and videos, and the sign
 * form's fields while unsigned; who signed and when once signed. The signing
 * itself is in the bottom bar and the card.
 *
 * `form` and `setForm` are the sign form the page holds, so the bar's button
 * and the card's move read the same fields. `members` are the staff lists'
 * names: `{ warehouse, technical }`.
 */
export function StageBody({ t, stage, rights, form, setForm, members, userId, onChanged }) {
  const [busy, setBusy] = useState(false);
  const row = stageRowOf(t, stage);
  const files = evidenceOf(t, stage);
  const signed = Boolean(row?.completed_at);
  const canSign = rights.canSign[stage];
  const signers = STAGE_SIGNERS[stage];
  const technical = stage === STAGE.TECHNICAL_INSPECTION;
  const checking = stage === STAGE.WAREHOUSE_CHECKING;
  const rated = checking || technical;
  const pickOther = picksOtherSigner(t, stage);
  const chooseSlot = choosesSlot(stage);
  const otherOptions = (checking ? members.warehouse : pickOther ? members.technical : []).map((m) => ({
    value: m.id,
    label: m.name,
  }));
  const blocker = !signed && canSign ? stageBlocker(t, stage, form) : null;
  const set = (patch) => setForm(stage, patch);

  const addFiles = async (picked) => {
    if (!row) return;
    setBusy(true);
    try {
      for (const file of picked) await transmittalService.attachEvidence(t.id, row.id, file);
      toast.success("Files added.");
      onChanged?.();
    } catch (error) {
      toast.error(ipasErrorMessage(error, "The files could not be added."));
    } finally {
      setBusy(false);
    }
  };

  const removeFile = async (file) => {
    setBusy(true);
    try {
      await transmittalService.removeEvidence({ id: file.id, storagePath: file.storage_path });
      onChanged?.();
    } catch (error) {
      toast.error(ipasErrorMessage(error, "The file could not be removed."));
    } finally {
      setBusy(false);
    }
  };

  const openFile = async (file) => {
    try {
      window.open(await transmittalService.evidenceUrl(file.storage_path), "_blank", "noopener");
    } catch (error) {
      toast.error(ipasErrorMessage(error, "The file could not be opened."));
    }
  };

  const slotNote = (slot) =>
    row?.[`${slot}_signature_declined`] ? " (declined)" : row?.[`${slot}_confirmed`] ? " (confirmed)" : " (not yet confirmed)";

  return (
    <div className="space-y-6 text-[13px]">
      {rated && (
        <div className="space-y-2">
          <p className={caption}>Ratings</p>
          {rights.canRate[stage] ? (
            <WarehouseRatings
              key={t.lines.map((l) => `${l.id}:${technical ? l.techRating : l.whRating}`).join("|")}
              transmittal={t}
              canRate
              technical={technical}
              onSaved={onChanged}
              members={technical ? members.technical : members.warehouse}
              currentUserId={userId}
            />
          ) : (
            <p className="text-muted-foreground">
              {t.state === stage
                ? `Lines are rated GC or NA by ${technical ? "Technical" : "the Warehouse"} while it is open.`
                : "Ratings are on the Lines row."}
            </p>
          )}
        </div>
      )}

      <div className="space-y-2">
        <p className={caption}>Pictures and videos</p>
        {files.length === 0 ? (
          <p className="text-muted-foreground">
            {row?.no_pictures_reason ? `None: ${row.no_pictures_reason}` : "None yet."}
          </p>
        ) : (
          <ul className="space-y-1">
            {files.map((file) => (
              <li key={file.id} className="flex items-center justify-between gap-2">
                <span className="truncate">
                  {file.file_name} <span className="text-muted-foreground">· {file.kind}</span>
                </span>
                <span className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="sm" onClick={() => openFile(file)} aria-label={`Open ${file.file_name}`}>
                    <ExternalLink size={14} />
                  </Button>
                  {!signed && canSign && file.uploaded_by === userId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFile(file)}
                      disabled={busy}
                      aria-label={`Remove ${file.file_name}`}
                    >
                      <Trash2 size={14} />
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {!signed && canSign && row && (
          <FileInput accept="image/*,video/*" multiple disabled={busy} onFiles={addFiles} variant="outline" size="sm">
            <Upload size={14} />
            Add pictures or videos
          </FileInput>
        )}
      </div>

      {signed ? (
        <div className="space-y-2">
          <p className={caption}>Signed</p>
          {row.remarks && <p className="whitespace-pre-line">{row.remarks}</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <p className={caption}>{signers.first}</p>
              <p>
                {row.first_signer?.name ?? "—"} · {formatWhen(row.first_signed_at)}
                <span className="ml-1 text-muted-foreground">{slotNote("first")}</span>
              </p>
            </div>
            <div>
              <p className={caption}>{signers.second}</p>
              <p>
                {row.second_signer?.name ?? row.second_signer_name ?? "—"} · {formatWhen(row.second_signed_at)}
                <span className="ml-1 text-muted-foreground">{slotNote("second")}</span>
              </p>
            </div>
          </div>
        </div>
      ) : canSign ? (
        <div className="space-y-3">
          <p className={caption}>Before you sign {STAGE_TITLE[stage]}</p>
          <FieldBox label="Remarks" bare>
            <Textarea rows={2} value={form.remarks} onChange={(e) => set({ remarks: e.target.value })} />
          </FieldBox>
          {files.length === 0 && (
            <FieldBox label="No pictures or videos: why" bare>
              <Input value={form.noPicturesReason} onChange={(e) => set({ noPicturesReason: e.target.value })} />
            </FieldBox>
          )}
          {chooseSlot && (
            <FieldBox label="You sign as" bare>
              <SelectField
                options={[
                  { value: "first", label: signers.first },
                  { value: "second", label: signers.second },
                ]}
                value={form.signAsSecond ? "second" : "first"}
                onChange={(v) => set({ signAsSecond: v === "second" })}
              />
            </FieldBox>
          )}
          {pickOther ? (
            <FieldBox label={chooseSlot && form.signAsSecond ? signers.first : signers.second} bare>
              <SelectField
                options={otherOptions}
                value={form.otherId}
                onChange={(v) => set({ otherId: v })}
                placeholder="Pick a name"
              />
            </FieldBox>
          ) : (
            <FieldBox label="Received by (typed name)" bare>
              <Input value={form.otherName} onChange={(e) => set({ otherName: e.target.value })} />
            </FieldBox>
          )}
          {blocker && <p className="text-muted-foreground">{blocker}</p>}
        </div>
      ) : (
        <p className="text-muted-foreground">Not signed yet.</p>
      )}

      <ClearedList entries={t.cleared.filter((c) => c.kind === "stage" && c.stage === stage)} />
    </div>
  );
}

/** Received in Odoo by: the optional Odoo receipt reference while unsigned, who and when once signed. */
export function OdooBody({ t, rights, odooRef, setOdooRef }) {
  const cleared = <ClearedList entries={t.cleared.filter((c) => c.kind === "odoo")} />;
  if (t.odooReceivedAt) {
    return (
      <div className="space-y-4">
        <p className="text-[13px]">
          {t.odooReceivedBy?.name ?? "Recorded"} · {formatWhen(t.odooReceivedAt)}
          {t.odooReceiptRef ? ` · ${t.odooReceiptRef}` : ""}
        </p>
        {cleared}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {rights.canRecordOdoo ? (
        <FieldBox label="Odoo receipt (optional)" bare>
          <Input value={odooRef} onChange={(e) => setOdooRef(e.target.value)} placeholder="WH/IN/01234" />
        </FieldBox>
      ) : (
        <p className="text-[13px] text-muted-foreground">Not yet.</p>
      )}
      {cleared}
    </div>
  );
}

/**
 * The two Check by plates: who signed each and when. A signer may decline
 * their stored signature, so the slip prints their name only, or apply it again.
 */
export function CheckByBody({ t, rights, userId, onChanged }) {
  const [busy, setBusy] = useState(false);
  // Declining asks first, like Sign, Confirm and Undo; applying again does not.
  const [decliningNumber, setDecliningNumber] = useState(null);
  const setDeclined = async (number, decline) => {
    setBusy(true);
    try {
      await transmittalService.checkSignature(t.id, number, decline);
      toast.success(decline ? "Signature declined. The slip prints your name only." : "Signature applied.");
      onChanged?.();
    } catch (error) {
      toast.error(ipasErrorMessage(error, "The signature could not be updated."));
    } finally {
      setBusy(false);
    }
  };
  const plate = (label, slot, number) => (
    <div className="flex-1 space-y-1 rounded-lg border border-border p-3">
      <p className={caption}>{label}</p>
      <p>
        {slot ? `${slot.name ?? "—"} · ${formatWhen(slot.at)}` : <span className="text-muted-foreground">Not yet.</span>}
        {slot?.signatureDeclined && <span className="ml-1 text-muted-foreground">(signature not applied)</span>}
      </p>
      {slot && userId && slot.id === userId && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => (slot.signatureDeclined ? setDeclined(number, false) : setDecliningNumber(number))}
        >
          {slot.signatureDeclined ? "Apply my signature" : "Decline my signature"}
        </Button>
      )}
    </div>
  );
  return (
    <div className="space-y-3 text-[13px]">
      <div className="flex flex-col gap-2 sm:flex-row">
        {plate("Check by (1)", t.checkBy.first, 1)}
        {plate("Check by (2)", t.checkBy.second, 2)}
      </div>
      {rights.checkByBlocked && (
        <p className="text-xs text-muted-foreground">
          Received in Odoo by is signed first: this slip carries a PO line.
        </p>
      )}
      <ClearedList entries={t.cleared.filter((c) => c.kind === "check_by")} />
      <ConfirmDialog
        open={decliningNumber !== null}
        onOpenChange={(open) => !open && setDecliningNumber(null)}
        title={`Decline my signature on Check by (${decliningNumber ?? ""})?`}
        confirmLabel="Decline"
        onConfirm={() => setDeclined(decliningNumber, true)}
      >
        <p className="text-sm text-muted-foreground">The slip will print your name only, without your signature.</p>
      </ConfirmDialog>
    </div>
  );
}
