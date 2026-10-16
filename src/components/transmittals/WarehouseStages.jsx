import { useState } from "react";
import toast from "react-hot-toast";
import { Check, ExternalLink, Trash2, Upload } from "lucide-react";

import { Button } from "../ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { FieldBox } from "../ui/FieldBox";
import { FileInput } from "../ui/FileInput";
import { Input } from "../ui/input";
import { SelectField } from "../ui/SelectField";
import { Textarea } from "../ui/textarea";
import { transmittalService } from "../../services/transmittalService";
import { evidenceOf, stageRowOf } from "../../utils/transmittals";
import { TRANSMITTAL_RATING, TRANSMITTAL_STAGE } from "../../constants/transmittals";
import { ipasErrorMessage } from "../../utils/ipas";

/** The slip state while each stage is the one being worked. */
const OPEN_STATE = {
  [TRANSMITTAL_STAGE.WAREHOUSE_CHECKING]: "warehouse_checking",
  [TRANSMITTAL_STAGE.WAREHOUSE_RELEASING]: "warehouse_releasing",
  [TRANSMITTAL_STAGE.TECHNICAL_INSPECTION]: "technical_inspection",
};

/**
 * The Warehouse's sections of a Transmittal (#253, spec #251): the line
 * ratings during Warehouse checking, the Warehouse checking and releasing
 * stages, and Received in Odoo. The database decides who may rate, sign and
 * add files, and refuses what it must; these only show and send.
 */

const STAGE_SIGNERS = {
  [TRANSMITTAL_STAGE.WAREHOUSE_CHECKING]: { first: "Received by", second: "Inspected by" },
  [TRANSMITTAL_STAGE.WAREHOUSE_RELEASING]: { first: "Released by", second: "Received by" },
  [TRANSMITTAL_STAGE.TECHNICAL_INSPECTION]: { first: "Received by", second: "Inspected by" },
};

const STAGE_TITLE = {
  [TRANSMITTAL_STAGE.WAREHOUSE_CHECKING]: "Warehouse checking",
  [TRANSMITTAL_STAGE.WAREHOUSE_RELEASING]: "Warehouse releasing",
  [TRANSMITTAL_STAGE.TECHNICAL_INSPECTION]: "Technical inspection",
};

const formatWhen = (value) => (value ? new Date(value).toLocaleString() : "");

const caption = "text-label font-bold uppercase tracking-wider text-muted-foreground";

/**
 * The ratings table: GC or NA per line, a remark on NA, and a quantity
 * received where it differs. `technical` rates the TCA side (Technical
 * inspection) instead; where Warehouse checking ran, its quantity stands.
 */
export function WarehouseRatings({ transmittal, canRate, onSaved, technical = false, members = [], currentUserId = null }) {
  const ratingOf = (line) => (technical ? line.techRating : line.whRating);
  const inChargeOf = (line) => (technical ? line.techInChargeId : line.whInChargeId);
  const inChargeNameOf = (line) => (technical ? line.techInChargeName : line.whInChargeName);
  const inChargeOptions = members.map((m) => ({ value: m.id, label: m.name }));
  const remarkOf = (line) => (technical ? line.techRemark : line.whRemark);
  const initial = Object.fromEntries(
    transmittal.lines.map((line) => [
      line.id,
      {
        rating: ratingOf(line),
        remark: remarkOf(line) ?? "",
        inChargeId: inChargeOf(line) ?? (members.some((m) => m.id === currentUserId) ? currentUserId : ""),
        quantityReceived: line.quantityReceived == null ? "" : String(line.quantityReceived),
      },
    ]),
  );
  const [draft, setDraft] = useState(initial);
  // One quantity per line: the Warehouse's, or Technical's on a slip with no Warehouse checking.
  const canSetQuantity = canRate && !(technical && transmittal.checkWarehouse);
  const [busy, setBusy] = useState(false);

  const setRow = (lineId, patch) => setDraft((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...patch } }));

  const save = async () => {
    const ratings = transmittal.lines
      .filter((line) => draft[line.id]?.rating)
      .map((line) => ({
        lineId: line.id,
        rating: draft[line.id].rating,
        remark: draft[line.id].remark,
        inChargeId: draft[line.id].inChargeId || null,
        quantityReceived: draft[line.id].quantityReceived,
      }));
    setBusy(true);
    try {
      await transmittalService.rateLines(transmittal.id, ratings);
      toast.success("Ratings saved.");
      onSaved?.();
    } catch (error) {
      toast.error(ipasErrorMessage(error, "The ratings could not be saved."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table tableId="transmittal-ratings" className="md:min-w-[48rem]">
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              {["#", "Item", "Quantity", "In-charge", "Rating", "Remark (NA needs one)", "Quantity received"].map((h) => (
                <TableHead key={h} className={caption}>
                  {h}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {transmittal.lines.map((line) => {
              const row = draft[line.id] ?? {};
              return (
                <TableRow key={line.id} className="align-top">
                  <TableCell>{line.position}</TableCell>
                  <TableCell>{line.description}</TableCell>
                  <TableCell>
                    {line.quantity} {line.unit ?? ""}
                  </TableCell>
                  <TableCell>
                    {canRate ? (
                      <SelectField
                        options={inChargeOptions}
                        value={row.inChargeId ?? ""}
                        onChange={(v) => setRow(line.id, { inChargeId: v })}
                        placeholder="Pick"
                        aria-label={`In-charge for line ${line.position}`}
                      />
                    ) : (
                      <span className="text-muted-foreground">{inChargeNameOf(line) || "—"}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {[TRANSMITTAL_RATING.GC, TRANSMITTAL_RATING.NA].map((value) => (
                        <Button
                          key={value}
                          size="sm"
                          variant={row.rating === value ? "default" : "outline"}
                          disabled={!canRate || busy}
                          aria-pressed={row.rating === value}
                          onClick={() => setRow(line.id, { rating: value })}
                        >
                          {value.toUpperCase()}
                        </Button>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    {row.rating === TRANSMITTAL_RATING.NA ? (
                      <Input
                        value={row.remark}
                        disabled={!canRate || busy}
                        aria-label={`Remark for line ${line.position}`}
                        onChange={(e) => setRow(line.id, { remark: e.target.value })}
                      />
                    ) : (
                      <span className="text-muted-foreground">{remarkOf(line) || "—"}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      className="w-28"
                      value={row.quantityReceived ?? ""}
                      disabled={!canSetQuantity || busy}
                      aria-label={`Quantity received for line ${line.position}`}
                      placeholder="Same"
                      onChange={(e) => setRow(line.id, { quantityReceived: e.target.value })}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {canRate && (
        <div className="flex justify-end">
          <Button size="sm" onClick={save} disabled={busy}>
            Save ratings
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * One stage (Warehouse checking, releasing or Technical inspection): its pictures and videos, its
 * remarks, the other signatory, and Complete. Once signed, the signatures and
 * the co-signer's confirm / decline. `members` are the staff lists' names for
 * the pickers: `{ warehouse, technical }`.
 */
export function WarehouseStageSignoff({ transmittal, stage, canSign, currentUserId, members, onChanged }) {
  const row = stageRowOf(transmittal, stage);
  const files = evidenceOf(transmittal, stage);
  const signed = !!row?.completed_at;
  const signers = STAGE_SIGNERS[stage];
  const [remarks, setRemarks] = useState("");
  const [noPicturesReason, setNoPicturesReason] = useState("");
  const [otherId, setOtherId] = useState("");
  const [otherName, setOtherName] = useState("");
  const [signAsSecond, setSignAsSecond] = useState(false);
  const [busy, setBusy] = useState(false);

  const isCheckingStage = stage === TRANSMITTAL_STAGE.WAREHOUSE_CHECKING;
  const isTechnicalStage = stage === TRANSMITTAL_STAGE.TECHNICAL_INSPECTION;
  const receiverFromTechnical = stage === TRANSMITTAL_STAGE.WAREHOUSE_RELEASING && transmittal.checkTechnical;
  // The other signatory is picked from a list on every stage but a typed Warehouse releasing.
  const pickOther = isCheckingStage || isTechnicalStage || receiverFromTechnical;
  // The two signatories may be the same person (spec #251), so the signer stays on the list.
  // Checking and Technical inspection: the caller signs as either signatory (spec #251).
  const chooseSlot = isCheckingStage || isTechnicalStage;
  const slotOptions = [
    { value: "first", label: signers.first },
    { value: "second", label: signers.second },
  ];
  const otherOptions = (isCheckingStage ? members.warehouse : pickOther ? members.technical : []).map((m) => ({
    value: m.id,
    label: m.name,
  }));

  const unrated = transmittal.lines.filter((line) =>
    isTechnicalStage ? !line.techRating || !line.techInChargeId : !line.whRating || !line.whInChargeId,
  ).length;
  const needsReason = files.length === 0;
  const blocker = (isCheckingStage || isTechnicalStage) && unrated > 0
    ? `${unrated} line${unrated === 1 ? "" : "s"} still need a GC or NA rating.`
    : needsReason && noPicturesReason.trim() === ""
      ? "Attach a picture or video, or give the reason none."
      : pickOther && !otherId
        ? "Pick the other signatory."
        : !pickOther && !otherName.trim()
          ? "Type who received the goods."
          : null;

  const afterChange = () => onChanged?.();

  const addFiles = async (picked) => {
    if (!row) return;
    setBusy(true);
    try {
      for (const file of picked) {
        await transmittalService.attachEvidence(transmittal.id, row.id, file);
      }
      toast.success("Files added.");
      afterChange();
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
      afterChange();
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

  const complete = async () => {
    setBusy(true);
    try {
      await transmittalService.completeStage(transmittal.id, {
        stage,
        otherSignerId: otherId || null,
        otherSignerName: otherId ? null : otherName.trim() || null,
        remarks: remarks.trim() || null,
        noPicturesReason: noPicturesReason.trim() || null,
        signAsSecond: chooseSlot && signAsSecond,
      });
      toast.success(`${STAGE_TITLE[stage]} signed.`);
      afterChange();
    } catch (error) {
      toast.error(ipasErrorMessage(error, "The stage could not be signed."));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (value) => {
    setBusy(true);
    try {
      await transmittalService.confirmSignature(row.id, value);
      toast.success(value ? "Signature confirmed." : "Signature declined.");
      afterChange();
    } catch (error) {
      toast.error(ipasErrorMessage(error, "The signature could not be updated."));
    } finally {
      setBusy(false);
    }
  };

  // The co-signer holds the slot still waiting: the second, or the first when the completer signed second.
  const waitingSlot = !signed
    ? null
    : !row.second_confirmed && !row.second_signature_declined
      ? "second"
      : !row.first_confirmed && !row.first_signature_declined
        ? "first"
        : null;
  const awaitingMyConfirm =
    !!currentUserId && !!waitingSlot && row[`${waitingSlot}_signer_id`] === currentUserId;
  const slotNote = (slot) =>
    row[`${slot}_signature_declined`] ? " (declined)" : row[`${slot}_confirmed`] ? " (confirmed)" : " (not yet confirmed)";

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4 text-[13px]">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{STAGE_TITLE[stage]}</p>
        <span className="text-muted-foreground">
          {signed
            ? "Signed"
            : row && (transmittal.state === OPEN_STATE[stage] || (stage === TRANSMITTAL_STAGE.WAREHOUSE_RELEASING && !transmittal.checkTechnical))
              ? stage === TRANSMITTAL_STAGE.WAREHOUSE_RELEASING && !transmittal.checkTechnical
                ? "Optional"
                : "Open"
              : "Not yet"}
        </span>
      </div>

      <div className="space-y-1">
        <p className={caption}>Pictures and videos</p>
        {files.length === 0 ? (
          <p className="text-muted-foreground">{row?.no_pictures_reason ? `None: ${row.no_pictures_reason}` : "None yet."}</p>
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
                  {!signed && canSign && file.uploaded_by === currentUserId && (
                    <Button variant="ghost" size="sm" onClick={() => removeFile(file)} disabled={busy} aria-label={`Remove ${file.file_name}`}>
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
          {row.remarks && <p className="whitespace-pre-line">{row.remarks}</p>}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                {row.second_signer_name ?? "—"} · {formatWhen(row.second_signed_at)}
                <span className="ml-1 text-muted-foreground">{slotNote("second")}</span>
              </p>
            </div>
          </div>
          {awaitingMyConfirm && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="gap-1.5" onClick={() => confirm(true)} disabled={busy}>
                <Check size={14} />
                Confirm my signature
              </Button>
              <Button size="sm" variant="outline" onClick={() => confirm(false)} disabled={busy}>
                Decline
              </Button>
            </div>
          )}
        </div>
      ) : (
        canSign &&
        (row || !isCheckingStage) && (
          <div className="space-y-3">
            <FieldBox label="Remarks" bare>
              <Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={busy} />
            </FieldBox>
            {needsReason && (
              <FieldBox label="No pictures or videos: why" bare>
                <Input value={noPicturesReason} onChange={(e) => setNoPicturesReason(e.target.value)} disabled={busy} />
              </FieldBox>
            )}
            {chooseSlot && (
              <FieldBox label="You sign as" bare>
                <SelectField
                  options={slotOptions}
                  value={signAsSecond ? "second" : "first"}
                  onChange={(v) => setSignAsSecond(v === "second")}
                />
              </FieldBox>
            )}
            {pickOther && (
              <FieldBox label={chooseSlot && signAsSecond ? signers.first : signers.second} bare>
                <SelectField options={otherOptions} value={otherId} onChange={setOtherId} placeholder="Pick a name" />
              </FieldBox>
            )}
            {!pickOther && (
              <FieldBox label="Received by (typed name)" bare>
                <Input value={otherName} onChange={(e) => setOtherName(e.target.value)} disabled={busy} />
              </FieldBox>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {blocker && <span className="text-muted-foreground">{blocker}</span>}
              <Button size="sm" onClick={complete} disabled={busy || !!blocker}>
                Sign {STAGE_TITLE[stage]}
              </Button>
            </div>
          </div>
        )
      )}
    </div>
  );
}

/** Received in Odoo by: the Warehouse list or Purchasing signs it, with an optional Odoo receipt reference. */
export function OdooReceiptSection({ transmittal, canRecord, onRecorded }) {
  const [ref, setRef] = useState("");
  const [busy, setBusy] = useState(false);
  const received = !!transmittal.odooReceivedAt;

  const record = async () => {
    setBusy(true);
    try {
      await transmittalService.receivedInOdoo(transmittal.id, ref.trim());
      toast.success("Received in Odoo recorded.");
      onRecorded?.();
    } catch (error) {
      toast.error(ipasErrorMessage(error, "The Odoo receipt could not be recorded."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-4 text-[13px]">
      <p className="text-sm font-semibold">Received in Odoo by</p>
      {received ? (
        <p>
          {transmittal.odooReceivedBy?.name ?? "Recorded"} · {formatWhen(transmittal.odooReceivedAt)}
          {transmittal.odooReceiptRef ? ` · ${transmittal.odooReceiptRef}` : ""}
        </p>
      ) : canRecord ? (
        <div className="flex flex-wrap items-end gap-2">
          <FieldBox label="Odoo receipt (optional)" bare>
            <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="WH/IN/01234" disabled={busy} />
          </FieldBox>
          <Button size="sm" onClick={record} disabled={busy}>
            Record receipt
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground">Not yet.</p>
      )}
    </div>
  );
}
