import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDown, ArrowUp, ListPlus, Plus, Trash2 } from "lucide-react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import ConfirmDialog from "../ui/ConfirmDialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import StatusBadge from "../StatusBadge";
import { costingMatrixService, CostingBandError } from "../../services/costingMatrixService";
import { opportunityService } from "../../services/opportunityService";
import { COSTING_BAND, tierReads } from "../../constants/costing";
import { formatPHP } from "../../constants/sor";
import { stockBadge, STOCK_BADGE_THEME } from "../../constants/stock";
import { costingKeys } from "./costingKeys";
import SorLinePicker from "./SorLinePicker";

/** A refusal in words: a band refusal names the column and who may write it. */
const refusalMessage = (error) =>
  error instanceof CostingBandError ? error.message : (error?.message || "Something went wrong.").replace(/^[a-z_]+: /, "");

const pesos = (value) => (value === null || value === undefined ? "—" : formatPHP(value));

/**
 * One cell you can type in. Saves when you leave it, and only if it changed. A
 * refusal (a band error, a bad number) shows under the cell and leaves what you
 * typed there. Read-only where the viewer is outside the column's band.
 */
function Cell({ value, onSave, readOnly, label, noun = label, multiline = false, numeric = false, money = false, required = false, align = "left" }) {
  const shown = value === null || value === undefined ? "" : String(value);
  const [draft, setDraft] = useState(shown);
  const [seen, setSeen] = useState(shown);
  const [error, setError] = useState(null);
  const [focused, setFocused] = useState(false);

  // Follow the saved value when it changes under us (a refresh), unless typing.
  if (seen !== shown && !focused) {
    setSeen(shown);
    setDraft(shown);
  }

  if (readOnly) {
    return (
      <span className={multiline ? "block whitespace-pre-line text-sm text-foreground" : "block text-sm tabular-nums text-foreground"} aria-label={label}>
        {shown === "" ? "—" : money ? formatPHP(Number(shown)) : shown}
      </span>
    );
  }

  const commit = async () => {
    setFocused(false);
    if (draft === shown) return;
    let next = draft;
    if (numeric) {
      const text = draft.trim();
      if (text === "") {
        if (required) return setError(`${noun} is needed.`);
        next = null;
      } else {
        const n = Number(text);
        if (!Number.isFinite(n) || n < 0 || (required && n === 0)) return setError(`${noun} must be a number${required ? " above zero" : ""}.`);
        next = n;
      }
    }
    try {
      setError(null);
      await onSave(next);
    } catch (err) {
      setError(refusalMessage(err));
    }
  };

  const shared = {
    value: draft,
    "aria-label": label,
    "aria-invalid": error ? true : undefined,
    onFocus: () => setFocused(true),
    onChange: (event) => {
      setDraft(event.target.value);
      if (error) setError(null);
    },
    onBlur: commit,
  };

  return (
    <div className="space-y-1">
      {multiline ? (
        <Textarea {...shared} rows={3} className="min-h-[64px] px-2 py-1.5 text-sm" />
      ) : (
        <Input
          {...shared}
          type={numeric ? "number" : "text"}
          min={numeric ? 0 : undefined}
          step={numeric ? "0.01" : undefined}
          className={`h-8 px-2 text-sm ${align === "right" ? "text-right tabular-nums" : ""}`}
        />
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function StockBadge({ line, snapshotData }) {
  const product = line.odoo_product_id ? snapshotData?.products?.[line.odoo_product_id] || null : null;
  const badge = stockBadge({ quantity: line.quantity, product, odooProductId: line.odoo_product_id });
  return <StatusBadge label={badge.label} theme={STOCK_BADGE_THEME[badge.kind]} title="Stock" />;
}

/**
 * The Tender Lines of the Costing Matrix (#267): what the client asked for, with
 * its ABC and our Final Offer, numbered 1, 2, …. Which columns show is the
 * viewer's tier (a Stage Participant gets the lines and no money); which cells
 * type is the viewer's band (only the Deal Team writes here), the rest read-only.
 * Every refusal shows beside what was refused.
 */
export default function TenderLineGrid({ matrix, opportunityId, actorId }) {
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [removing, setRemoving] = useState(null);
  const [busy, setBusy] = useState(false);

  const canWrite = matrix.bands.includes(COSTING_BAND.SALES);
  const showAbc = tierReads(matrix.tier, "abc_unit");
  const showOffer = tierReads(matrix.tier, "final_offer_unit");
  const showQuotation = tierReads(matrix.tier, "quotation_price_unit");
  const lines = matrix.tenderLines;

  const { data: stockSnapshot } = useQuery({
    queryKey: costingKeys.stock(opportunityId),
    queryFn: () => opportunityService.getStockSnapshot(opportunityId),
    enabled: lines.some((l) => l.source === "sor_line"),
    retry: false,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: costingKeys.all(opportunityId) });

  // A write from a control (not a cell): run it, refresh, and show a refusal above the grid.
  const run = async (work) => {
    setBusy(true);
    setNotice(null);
    try {
      await work();
      await refresh();
    } catch (error) {
      setNotice(refusalMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const saveLine = async (line, fields) => {
    await costingMatrixService.updateTenderLine(line.id, fields);
    await refresh();
  };

  const move = (index, by) => {
    const ids = lines.map((l) => l.id);
    const target = index + by;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    run(() => costingMatrixService.reorder(matrix.matrixId, ids));
  };

  const { totals } = matrix;

  return (
    <div className="space-y-3">
      {canWrite && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => run(() => costingMatrixService.addTenderLine(matrix.matrixId, {}, actorId))}>
            <Plus size={14} aria-hidden="true" />
            Add Tender Line
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setPickerOpen(true)}>
            <ListPlus size={14} aria-hidden="true" />
            Pick from an SOR line
          </Button>
        </div>
      )}

      {notice && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {notice}
        </p>
      )}

      {lines.length === 0 ? (
        <p className="rounded-xl border border-border/70 bg-card/50 px-4 py-6 text-center text-sm text-muted-foreground">
          No Tender Lines yet.{canWrite ? " Add what the client asked for, or pick it from the SOR's products." : ""}
        </p>
      ) : (
        <div className="rounded-xl border border-border/70 bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">No.</TableHead>
                <TableHead className="min-w-[16rem]">Tender Specification</TableHead>
                <TableHead className="w-24">Unit</TableHead>
                <TableHead className="w-24 text-right">Qty</TableHead>
                {showAbc && <TableHead className="w-36 text-right">ABC / unit</TableHead>}
                {showAbc && <TableHead className="w-36 text-right">ABC total</TableHead>}
                {showOffer && <TableHead className="w-40 text-right">Final Offer / unit</TableHead>}
                {showOffer && <TableHead className="w-36 text-right">Final Offer total</TableHead>}
                <TableHead className="w-28">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line, index) => (
                <TableRow key={line.id} data-testid="tender-line">
                  <TableCell className="align-top font-semibold tabular-nums">{line.number}</TableCell>
                  <TableCell className="align-top">
                    <Cell
                      label={`Tender Specification ${line.number}`}
                      value={line.tender_specification}
                      multiline
                      readOnly={!canWrite}
                      onSave={(value) => saveLine(line, { tenderSpecification: value })}
                    />
                    {line.source === "sor_line" && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                        <span className="text-muted-foreground">From an SOR line</span>
                        {line.sorChange && <span className="font-medium text-amber-12">{line.sorChange.label}</span>}
                        <StockBadge line={line} snapshotData={stockSnapshot?.data} />
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="align-top">
                    <Cell label={`Unit ${line.number}`} value={line.unit} readOnly={!canWrite} onSave={(value) => saveLine(line, { unit: value })} />
                  </TableCell>
                  <TableCell className="align-top">
                    <Cell
                      label={`Quantity ${line.number}`}
                      noun="Quantity"
                      value={line.quantity}
                      numeric
                      required
                      align="right"
                      readOnly={!canWrite}
                      onSave={(value) => saveLine(line, { quantity: value })}
                    />
                  </TableCell>
                  {showAbc && (
                    <TableCell className="align-top">
                      <Cell
                        label={`ABC ${line.number}`}
                        noun="ABC"
                        value={line.abc_unit}
                        numeric
                        money
                        align="right"
                        readOnly={!canWrite}
                        onSave={(value) => saveLine(line, { abcUnit: value })}
                      />
                    </TableCell>
                  )}
                  {showAbc && <TableCell className="text-right align-top text-sm tabular-nums">{pesos(line.totals.abcTotal)}</TableCell>}
                  {showOffer && (
                    <TableCell className="align-top">
                      <Cell
                        label={`Final Offer ${line.number}`}
                        noun="Final Offer"
                        value={line.final_offer_unit}
                        numeric
                        money
                        align="right"
                        readOnly={!canWrite}
                        onSave={(value) => saveLine(line, { finalOfferUnit: value })}
                      />
                      {showQuotation && line.quotation_price_unit != null && Number(line.quotation_price_unit) !== Number(line.final_offer_unit) && (
                        <p className="mt-1 text-right text-xs text-muted-foreground" data-testid="quotation-price">
                          Quotation {formatPHP(Number(line.quotation_price_unit))}
                        </p>
                      )}
                    </TableCell>
                  )}
                  {showOffer && (
                    <TableCell className="text-right align-top text-sm tabular-nums">
                      <span className="block">{pesos(line.totals.finalOfferTotal)}</span>
                      {line.totals.overAbc && (
                        <StatusBadge label="Over ABC" theme="red" className="mt-1" title="Final Offer total is above the ABC total" />
                      )}
                    </TableCell>
                  )}
                  <TableCell className="align-top">
                    {canWrite && (
                      <div className="flex items-center justify-end gap-0.5">
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move Tender Line ${line.number} up`} disabled={busy || index === 0} onClick={() => move(index, -1)}>
                          <ArrowUp size={14} aria-hidden="true" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move Tender Line ${line.number} down`} disabled={busy || index === lines.length - 1} onClick={() => move(index, 1)}>
                          <ArrowDown size={14} aria-hidden="true" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove Tender Line ${line.number}`} disabled={busy} onClick={() => setRemoving(line)}>
                          <Trash2 size={14} aria-hidden="true" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(showAbc || showOffer) && (
                <TableRow data-testid="tender-totals">
                  <TableCell colSpan={4} className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Total
                  </TableCell>
                  {showAbc && <TableCell />}
                  {showAbc && (
                    <TableCell className="text-right text-sm font-semibold tabular-nums">
                      {pesos(totals.abcTotal)}
                      {totals.missingAbc > 0 && <span className="block text-xs font-normal text-muted-foreground">{totals.missingAbc} without ABC</span>}
                    </TableCell>
                  )}
                  {showOffer && <TableCell />}
                  {showOffer && (
                    <TableCell className="text-right text-sm font-semibold tabular-nums">
                      {pesos(totals.finalOfferTotal)}
                      {totals.missingOffer > 0 && (
                        <span className="block text-xs font-normal text-muted-foreground">{totals.missingOffer} without Final Offer</span>
                      )}
                    </TableCell>
                  )}
                  <TableCell />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {showAbc && showOffer && totals.percentOfAbc !== null && (
        <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="abc-percent">
          <span className="font-semibold tabular-nums">{totals.percentOfAbc.toFixed(1)}%</span>
          <span className="text-muted-foreground">of the ABC</span>
          {totals.overAbc && <StatusBadge label="Over ABC" theme="red" title="The Final Offer total is above the ABC total" />}
        </p>
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={removing ? `Remove Tender Line ${removing.number}?` : "Remove Tender Line?"}
        description="Its ABC and Final Offer go with it. The change stays in the history."
        confirmLabel="Remove"
        tone="destructive"
        onConfirm={() => {
          const target = removing;
          setRemoving(null);
          run(() => costingMatrixService.removeTenderLine(target.id));
        }}
      />

      <SorLinePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        opportunityId={opportunityId}
        onPick={(sorLine) => run(() => costingMatrixService.addTenderLineFromSorLine(matrix.matrixId, sorLine, {}, actorId))}
        busy={busy}
      />
    </div>
  );
}
