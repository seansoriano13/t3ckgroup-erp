import { useState } from "react";
import toast from "react-hot-toast";

import { Button } from "../ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { Input } from "../ui/input";
import { SelectField } from "../ui/SelectField";
import { transmittalService } from "../../services/transmittalService";
import { TRANSMITTAL_RATING } from "../../constants/transmittals";
import { ipasErrorMessage } from "../../utils/ipas";

/**
 * The line ratings of a Transmittal stage (#253, spec #251). The database
 * decides who may rate, and refuses what it must; this only shows and sends.
 */

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
                        className="min-w-64"
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

