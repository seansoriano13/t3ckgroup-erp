import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ExternalLink as ExternalLinkIcon, LockOpen, Paperclip, Pencil, Plus, Trash2, X } from "lucide-react";

import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ModalShell from "@/components/ui/ModalShell";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/ui/external-link";
import { AttachmentList } from "@/components/ui/Attachments";
import { FileInput } from "@/components/ui/FileInput";
import { RequiredMark } from "@/components/ipas/record/FormFields";
import StatusBadge from "../StatusBadge";
import { Cell, Readout } from "../costing/GridCell";
import { useCostingMatrix, useCostingTier } from "../costing/useCostingMatrix";
import { pesos } from "../costing/gridFormat";
import { cn } from "@/lib/utils";
import { CAPTION_BASE } from "@/lib/captionStyle";
import { useAuth } from "../../context/AuthContext";
import { COSTING_TIER } from "../../constants/costing";
import { MEMBER_SIDE } from "../../constants/purchaseRequest";
import { canvassService } from "../../services/canvassService";
import { purchaseRequestService } from "../../services/purchaseRequestService";
import { storageService } from "../../services/storageService";
import { CANVASS_STATE_LABEL } from "../../utils/canvassStatus";
import {
  LINE_STATE_THEME,
  buildCanvassGrid,
  canUnlockLine,
  cellLiner,
  formatAmount,
  pickAllBlockedReason,
  pickBlockedReason,
} from "../../utils/canvassGrid";
import { projectOffer } from "../../utils/offerProjection";
import { getPermissionContext } from "../../utils/permissions";
import { isAllowedAttachment } from "../../utils/attachments";
import CanvassReasonDialog from "./CanvassReasonDialog";
import CanvassSupplierDialog from "./CanvassSupplierDialog";
import { canvassKeys, purchaseRequestKeys } from "./queryKeys";
import { refusal, useRefreshRequest } from "./requestHooks";

/**
 * The request's Canvass as one grid (#970, spec #956, ADR 0053), like the sheet's PMS 3 CANVASS
 * MATRIX tab: the request's lines go down, the suppliers across. The line column stays put while
 * the suppliers scroll sideways. Each place where a line meets a supplier takes that supplier's
 * price (and, in the liner under the row, brand, description, source link, remarks and brochure);
 * an empty place means the supplier did not quote the line.
 *
 * What a cell opens is a one-line liner under the row, never a table inside it. A line that has a
 * winner always shows it in a liner of its own, with the reason, which can be rewritten.
 *
 * Opening the grid writes nothing (the first supplier added starts the Canvass). Only Purchasing
 * edits; anyone else the database lets read it sees it plain. A reader who may not see money gets
 * the grid with no prices and no rates, because the service sent none. The database owns the
 * rules (three suppliers or a "No other supplier" note, a reason per winner, the lock on a
 * Purchased line); the grid says them before the click and shows the database's words if it
 * refuses anyway.
 *
 * `focusItemId` scrolls to that line and rings it, so a line's notes can open the grid at it.
 */

const HINT = "text-xs text-muted-foreground";
const LINER = "flex flex-wrap items-end gap-x-3 gap-y-2 border-b border-border bg-muted/30 px-3 py-2";
const COLUMNS = (count) => `minmax(13rem,15rem) repeat(${Math.max(count, 1)}, minmax(15rem,17rem))`;
const BRAND_LABEL = "Brand";

/** A caption over a field in a liner; a star marks a required one. */
function Caption({ children, required }) {
  return (
    <span className={cn(CAPTION_BASE, "block tracking-wider text-muted-foreground")}>
      {children}
      {required && <RequiredMark />}
    </span>
  );
}

function Labeled({ caption, required, className, children }) {
  return (
    <div className={cn("min-w-[9rem] flex-1 basis-40", className)}>
      <Caption required={required}>{caption}</Caption>
      {children}
    </div>
  );
}

/** "If this offer wins" (#321): the Component's Acquire and Markup Price, and for the Closed Book the margin and summary. Never stored. */
function Projection({ projection, label = "If this offer wins" }) {
  if (!projection) return null;
  const { margin, summary } = projection;
  return (
    <p className={cn(HINT, "w-full")} data-testid="offer-projection">
      <span className="font-semibold text-foreground">{label}</span>
      <span className="ml-2" data-testid="projection-acquire">Acquire {pesos(projection.acquireUnit)}</span>
      {projection.markupPriceUnit !== null && (
        <span className="ml-2" data-testid="projection-markup-price">Markup Price {pesos(projection.markupPriceUnit)}</span>
      )}
      {margin && (
        <span className="ml-2" data-testid="projection-margin">
          Margin {pesos(margin.projected.amount)}
          {margin.projected.percent !== null && ` (${margin.projected.percent}%)`} · now {pesos(margin.current.amount)}
        </span>
      )}
      {summary && (
        <span className="ml-2" data-testid="projection-summary">
          Revenue {pesos(summary.revenue.to)} · now {pesos(summary.revenue.from)}
        </span>
      )}
    </p>
  );
}

/** The brochure of one cell: the files already there with a remove, and an attach button that uploads on choosing. */
function Brochure({ files, readOnly, onChange }) {
  const picker = useRef(null);
  const [busy, setBusy] = useState(false);

  const add = async (picked) => {
    const accepted = Array.from(picked || []).filter((file) => {
      if (isAllowedAttachment(file)) return true;
      toast.error(`${file.name} is not a supported file type.`);
      return false;
    });
    if (accepted.length === 0) return;
    setBusy(true);
    try {
      const uploaded = await Promise.all(accepted.map((file) => storageService.uploadFileToCloudinary(file)));
      await onChange([...files, ...uploaded].slice(0, 3));
    } catch (err) {
      toast.error(refusal(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Caption>Brochure</Caption>
      {files.length === 0 && readOnly && <span className={HINT}>—</span>}
      <AttachmentList attachments={files} compact />
      {!readOnly &&
        files.map((file) => (
          <Button
            key={file.url}
            type="button"
            variant="link"
            aria-label={`Remove ${file.name}`}
            onClick={() => onChange(files.filter((f) => f.url !== file.url))}
            className="h-auto p-0 text-[10px] font-semibold text-muted-foreground underline hover:text-foreground"
          >
            remove
          </Button>
        ))}
      {!readOnly && files.length < 3 && (
        <>
          <FileInput ref={picker} multiple onFiles={add} />
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => picker.current?.open()} className="h-7 px-2 text-xs">
            <Paperclip size={12} aria-hidden="true" />
            {busy ? "Uploading…" : "Attach"}
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * What one place of the grid opens: the brand, description, source link and remarks as boxes in one
 * wrapping line, the brochure, and "No quote" to take the supplier's answer off the line.
 */
function CellLiner({ line, supplier, cell, editable, save, onRemove, onClose, projection }) {
  const quote = cell.quote ?? {};
  const tag = `${supplier.name}, ${line.item.name}`;
  const field = (key, caption, extra = {}) => (
    <Labeled caption={caption}>
      <Cell label={`${caption}, ${tag}`} noun={caption} value={quote[key] ?? ""} readOnly={!editable} onSave={(v) => save({ [extra.input ?? key]: v })} {...extra.cell} />
    </Labeled>
  );

  return (
    <div className={LINER} data-testid="cell-liner" role="group" aria-label={`Quote details, ${tag}`}>
      {field("brand", BRAND_LABEL, { input: "brand" })}
      {field("description", "Description")}
      <Labeled caption="Source link" className="basis-52">
        <div className="flex items-center gap-1">
          <Cell label={`Source link, ${tag}`} noun="Source link" value={quote.source_link ?? ""} readOnly={!editable} onSave={(v) => save({ sourceLink: v })} className="min-w-0 flex-1" />
          {quote.source_link && (
            <ExternalLink href={quote.source_link} aria-label={`Open the source link, ${tag}`} className="shrink-0 text-muted-foreground hover:text-foreground">
              <ExternalLinkIcon size={14} aria-hidden="true" />
            </ExternalLink>
          )}
        </div>
      </Labeled>
      {field("remarks", "Remarks")}
      <div className="flex min-w-0 flex-wrap items-center gap-2 pb-1">
        <Brochure files={quote.brochure ?? []} readOnly={!editable || !cell.quoted} onChange={(files) => save({ brochure: files })} />
        {editable && cell.quoted && (
          <Button type="button" variant="ghost" size="sm" onClick={onRemove} className="h-7 px-2 text-xs text-muted-foreground">
            <Trash2 size={12} aria-hidden="true" />
            No quote
          </Button>
        )}
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Close details" onClick={onClose} className="h-7 w-7">
          <X size={14} aria-hidden="true" />
        </Button>
      </div>
      <Projection projection={projection} />
    </div>
  );
}

/** One supplier's header: who, currency, rate, how long it holds, lead time, quality, and its actions. */
function SupplierHeader({ supplier, canReadMoney, canEdit, wins, winsBlocked, onEdit, onRemove, onWinsAll }) {
  return (
    <div role="columnheader" className="flex min-w-0 flex-col gap-1 border-b border-r border-border bg-card px-3 py-2" data-testid={`supplier-${supplier.id}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 break-words text-sm font-semibold text-foreground">{supplier.name}</p>
        {canEdit && (
          <div className="flex shrink-0 items-center">
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Edit ${supplier.name}`} onClick={onEdit} className="h-6 w-6">
              <Pencil size={12} aria-hidden="true" />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${supplier.name}`} onClick={onRemove} className="h-6 w-6">
              <Trash2 size={12} aria-hidden="true" />
            </Button>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <StatusBadge label={supplier.currency} theme={supplier.foreign ? "violet" : "mauve"} title="Currency" />
        {supplier.expired && <StatusBadge label="Quote expired" theme="red" />}
        {canReadMoney && supplier.foreign && (supplier.rateMissing ? <StatusBadge label="No rate" theme="amber" /> : <span className={HINT}>Rate {supplier.rate}</span>)}
      </div>
      <p className={HINT}>
        {[
          supplier.validUntil && `Holds until ${String(supplier.validUntil).slice(0, 10)}`,
          supplier.leadTime && `Lead time ${supplier.leadTime}`,
        ]
          .filter(Boolean)
          .join(" · ") || "No hold or lead time yet"}
      </p>
      {supplier.qualityNote && <p className={cn(HINT, "break-words")}>{supplier.qualityNote}</p>}
      {canEdit && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={Boolean(winsBlocked)}
          title={winsBlocked ?? undefined}
          aria-label={`${supplier.name} wins every line`}
          onClick={onWinsAll}
          className="mt-0.5 h-7 w-fit px-2 text-xs"
        >
          {wins}
        </Button>
      )}
    </div>
  );
}

export default function CanvassGrid({ request, focusItemId = null, className }) {
  const requestId = request?.id;
  const { user } = useAuth();
  const actorId = user?.id ?? null;
  const isSuperAdmin = getPermissionContext(user).isSuperAdmin;
  const refresh = useRefreshRequest(requestId);

  const [openCell, setOpenCell] = useState(null);
  const [supplierDialog, setSupplierDialog] = useState(null); // { supplier } | {} for a new one
  const [reasonFor, setReasonFor] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [clearingNote, setClearingNote] = useState(false);

  const itemsQuery = useQuery({
    queryKey: purchaseRequestKeys.items(requestId),
    queryFn: () => purchaseRequestService.listItems(requestId),
    enabled: Boolean(requestId),
  });
  const canvassQuery = useQuery({
    queryKey: canvassKeys.request(requestId),
    queryFn: () => canvassService.getForRequest(requestId),
    enabled: Boolean(requestId),
  });
  const { data: actor } = useQuery({
    queryKey: purchaseRequestKeys.itemActor(requestId),
    queryFn: () => purchaseRequestService.itemActor(requestId),
    enabled: Boolean(requestId),
  });

  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);
  const canvass = canvassQuery.data ?? null;
  const canEdit = actor?.side === MEMBER_SIDE.PURCHASING;

  const lockedCandidates = items.filter((i) => ["purchased", "received"].includes(i.status));
  const { data: unlockedIds } = useQuery({
    queryKey: canvassKeys.unlocks(requestId),
    queryFn: () => canvassService.unlockedItemIds(lockedCandidates.map((i) => i.id)),
    enabled: lockedCandidates.length > 0,
  });

  const grid = useMemo(() => buildCanvassGrid({ items, canvass, unlockedIds: unlockedIds ?? new Set() }), [items, canvass, unlockedIds]);

  // Offer Projection (#321): only a line that names a Component has a figure to project, and the
  // database serves it to the Closed Book and Cost tiers only.
  const componentOf = (item) => item.component_id ?? item.component?.id ?? null;
  const wantsProjection = Boolean(canvass?.id) && grid.canReadMoney && items.some(componentOf);
  const { data: projections } = useQuery({
    queryKey: canvassKeys.projection(requestId),
    queryFn: () => canvassService.offerProjection(canvass.id),
    enabled: wantsProjection,
    staleTime: 0,
  });
  const opportunityId = request?.opportunity_id ?? null;
  const { data: tier } = useCostingTier(projections ? opportunityId : null);
  const { data: matrix } = useCostingMatrix(tier === COSTING_TIER.CLOSED_BOOK ? opportunityId : null);
  const projectionOf = (line, cell) => {
    const componentId = componentOf(line.item);
    if (!componentId || !cell?.quote) return null;
    return projectOffer({ projection: (projections || []).find((p) => p.quote_id === cell.quote.id), componentId, matrix });
  };

  // Scroll to the line a note opened the grid at.
  const focusRef = useRef(null);
  useEffect(() => {
    focusRef.current?.scrollIntoView?.({ block: "center" });
  }, [focusItemId, itemsQuery.isSuccess]);

  // A cell's save waits for the database and lets its refusal reach the box, which shows it under the cell.
  const strict = async (work) => {
    await work();
    refresh();
  };
  // A button's action reports the refusal as a toast.
  const attempt = async (work, ok) => {
    try {
      const result = await work();
      refresh();
      if (ok) toast.success(typeof ok === "function" ? ok(result) : ok);
      return result;
    } catch (err) {
      toast.error(refusal(err));
      return null;
    }
  };

  if (itemsQuery.isLoading || canvassQuery.isLoading) {
    return <p className={cn(HINT, "py-8 text-center")}>Loading the Canvass…</p>;
  }
  if (itemsQuery.isError || canvassQuery.isError) {
    return (
      <p role="alert" className="py-8 text-center text-sm text-destructive">
        Couldn’t load the Canvass.
      </p>
    );
  }

  const { strip, suppliers, lines, canReadMoney } = grid;
  const supplierNameOf = (id) => suppliers.find((s) => s.id === id)?.name ?? "this supplier";
  const columns = COLUMNS(suppliers.length);
  const width = `calc(15rem + ${Math.max(suppliers.length, 1)} * 17rem)`;

  const savePrice = (line, supplier, unitPrice) => strict(() => canvassService.saveQuote(supplier.id, line.id, { unitPrice }));
  const saveQuote = (line, supplier, patch) => strict(() => canvassService.saveQuote(supplier.id, line.id, patch));

  const ask = (next) => setReasonFor(next);
  const submitReason = async (reason) => {
    const { kind, line, supplier } = reasonFor;
    if (kind === "pick") {
      await canvassService.setWinner(line.id, supplier.id, reason, actorId);
      toast.success(`${supplier.name} wins ${line.item.name}.`);
    } else if (kind === "all") {
      const { picked, skipped } = await canvassService.pickSupplierForAll(canvass.id, supplier.id, reason);
      toast.success(`${supplier.name} wins ${picked} ${picked === 1 ? "line" : "lines"}${skipped ? `; ${skipped} skipped` : ""}.`);
    } else if (kind === "same") {
      const { changed } = await canvassService.useSameReason(canvass.id, reason);
      toast.success(`The same reason is on ${changed} ${changed === 1 ? "line" : "lines"}.`);
    } else if (kind === "note") {
      await canvassService.markNoOtherSupplier(canvass.id, reason, actorId);
      toast.success("Noted: no other supplier.");
    } else if (kind === "unlock") {
      await canvassService.unlockLine(line.id, reason);
      toast.success(`${line.item.name} is unlocked.`);
    }
    refresh();
  };

  const REASON_COPY = {
    pick: (a) => ({
      crumbs: ["Canvass", "Pick a winner"],
      title: `${a.supplier.name} wins ${a.line.item.name}?`,
      intro: "Say why. The reason is kept with the winner and printed on the Canvass.",
      label: "Why this supplier",
      initial: a.line.winner?.reason ?? "",
      confirmLabel: "Pick winner",
    }),
    all: (a) => ({
      crumbs: ["Canvass", "Wins every line"],
      title: `${a.supplier.name} wins every line it quoted?`,
      intro: "It is picked on every line it quoted, with this one reason. Lines it did not quote, and Purchased lines, are skipped.",
      label: "Why this supplier",
      confirmLabel: "Pick on every line",
    }),
    same: () => ({
      crumbs: ["Canvass", "Same reason for all"],
      title: "Use the same reason for all?",
      intro: "This reason replaces the one on every picked line that is not locked.",
      label: "Reason",
      confirmLabel: "Use for all",
    }),
    note: () => ({
      crumbs: ["Canvass", "No other supplier"],
      title: "No other supplier?",
      intro: "It stands in for the suppliers this Canvass is short of. It counts toward the three until a supplier fills that place.",
      label: "Why there is no other supplier",
      initial: strip.note?.reason ?? "",
      confirmLabel: "Save note",
    }),
    unlock: (a) => ({
      crumbs: ["Canvass", "Unlock"],
      title: `Unlock ${a.line.item.name}?`,
      intro: "Its prices, winner and reason can change again. The reason is kept in the history.",
      label: "Why it is being unlocked",
      confirmLabel: "Unlock",
    }),
  };
  const reasonCopy = reasonFor ? REASON_COPY[reasonFor.kind](reasonFor) : null;

  const unitCount = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)} data-testid="canvass-grid">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2" role="status" aria-label="Where the Canvass stands" data-testid="canvass-strip">
        {canvass?.number && <span className="text-sm font-semibold text-foreground">{canvass.number}</span>}
        <StatusBadge label={grid.stateLabel ?? CANVASS_STATE_LABEL[grid.state]} theme={LINE_STATE_THEME[grid.state]} />
        <span className="text-sm text-foreground tabular-nums" data-testid="strip-suppliers">{strip.suppliersText}</span>
        <span className="text-sm text-foreground tabular-nums" data-testid="strip-lines">{strip.linesText}</span>
        {strip.note && (
          <span className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground" data-testid="strip-note">
            <span className="font-medium text-foreground">No other supplier:</span>
            <span className="min-w-0 break-words">{strip.note.reason}</span>
            {canEdit && (
              <Button type="button" variant="link" onClick={() => setClearingNote(true)} className="h-auto p-0 text-xs underline">
                Remove note
              </Button>
            )}
          </span>
        )}
        {canEdit && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {suppliers.length > 0 && suppliers.length < 3 && !strip.note && (
              <Button type="button" variant="outline" size="sm" onClick={() => ask({ kind: "note" })}>
                No other supplier
              </Button>
            )}
            {strip.winnerCount > 0 && (
              <Button type="button" variant="outline" size="sm" onClick={() => ask({ kind: "same" })}>
                Same reason for all
              </Button>
            )}
            <Button type="button" size="sm" onClick={() => setSupplierDialog({})}>
              <Plus size={14} aria-hidden="true" />
              Add a supplier
            </Button>
          </div>
        )}
      </div>

      {!canReadMoney && suppliers.length > 0 && <p className={HINT}>Prices and rates are not shown to you.</p>}
      {lines.length === 0 && <p className={cn(HINT, "py-6 text-center")}>This request has no open lines to canvass.</p>}
      {suppliers.length === 0 && lines.length > 0 && (
        <p className={HINT}>
          {canEdit ? "No supplier yet. Add the first one to start the Canvass." : "No Canvass has been started on this request."}
        </p>
      )}

      {lines.length > 0 && (
        <div className="min-h-0 overflow-auto rounded-lg border border-border" data-testid="canvass-scroller">
          <div role="grid" aria-label="Canvass" className="grid bg-card" style={{ gridTemplateColumns: columns, minWidth: width }}>
            <div role="row" className="contents">
              <div role="columnheader" className="sticky left-0 z-20 border-b border-r border-border bg-card px-3 py-2">
                <Caption>Line</Caption>
                <p className={HINT}>Name, quantity, unit</p>
              </div>
              {suppliers.map((supplier) => (
                <SupplierHeader
                  key={supplier.id}
                  supplier={supplier}
                  canReadMoney={canReadMoney}
                  canEdit={canEdit}
                  wins="Wins every line"
                  winsBlocked={pickAllBlockedReason(grid, supplier.id)}
                  onEdit={() => setSupplierDialog({ supplier })}
                  onRemove={() => setRemoving(supplier)}
                  onWinsAll={() => ask({ kind: "all", supplier })}
                />
              ))}
            </div>

            {lines.map((line) => {
              const item = line.item;
              const focused = focusItemId === line.id;
              const editable = canEdit && !line.locked;
              const openHere = openCell && openCell.lineId === line.id ? suppliers.find((s) => s.id === openCell.supplierId) : null;
              const openCellData = openHere ? line.cells.find((c) => c.supplierId === openHere.id) : null;
              const winnerCell = line.winner ? line.cells.find((c) => c.supplierId === line.winner.supplierId) : null;
              return (
                <div key={line.id} role="rowgroup" className="contents" data-testid="canvass-line" data-focused={focused || undefined}>
                  <div role="row" className="contents">
                    <div
                      ref={focused ? focusRef : undefined}
                      role="rowheader"
                      aria-label={item.name}
                      className={cn("sticky left-0 z-10 flex min-w-0 flex-col gap-1 border-b border-r border-border bg-card px-3 py-2", focused && "ring-2 ring-inset ring-blue-8")}
                    >
                      <p className="min-w-0 break-words text-sm font-semibold text-foreground">{item.name}</p>
                      <p className={HINT}>
                        {item.quantity} {item.unit ?? ""}
                      </p>
                      <div className="flex flex-wrap items-center gap-1">
                        <StatusBadge label={CANVASS_STATE_LABEL[line.state]} theme={LINE_STATE_THEME[line.state]} />
                        {canUnlockLine(line, isSuperAdmin) && (
                          <Button type="button" variant="outline" size="sm" onClick={() => ask({ kind: "unlock", line })} className="h-6 px-2 text-xs">
                            <LockOpen size={12} aria-hidden="true" />
                            Unlock
                          </Button>
                        )}
                      </div>
                    </div>

                    {line.cells.map((cell, index) => {
                      const supplier = suppliers[index];
                      const tag = `${supplier.name}, ${item.name}`;
                      const blocked = pickBlockedReason(grid, line, cell);
                      const isOpen = openHere?.id === supplier.id;
                      const hint = cellLiner(cell);
                      return (
                        <div
                          key={supplier.id}
                          role="gridcell"
                          data-testid={`cell-${line.id}-${supplier.id}`}
                          data-winner={cell.winner || undefined}
                          className={cn("flex min-w-0 flex-col gap-1 border-b border-r border-border px-3 py-2", cell.winner && "bg-green-a2")}
                        >
                          {canReadMoney ? (
                            <Cell
                              label={`Unit price, ${tag}`}
                              noun="Unit price"
                              numeric
                              money={supplier.currency === "PHP"}
                              value={cell.unitPrice}
                              readOnly={!editable}
                              placeholder={`Price (${supplier.currency})`}
                              onSave={(value) => savePrice(line, supplier, value)}
                            />
                          ) : (
                            <Readout label={`Quote, ${tag}`}>{cell.quoted ? "Quoted" : "—"}</Readout>
                          )}
                          {canReadMoney && cell.total !== null && (
                            <p className="text-xs tabular-nums text-muted-foreground" data-testid="cell-total" aria-label={`Total, ${tag}`}>
                              Total {formatAmount(cell.total, supplier.currency)}
                            </p>
                          )}
                          {hint && <p className={cn(HINT, "truncate")} title={hint}>{hint}</p>}
                          <div className="flex flex-wrap items-center gap-1">
                            {cell.cheapest && <StatusBadge label="Cheapest" theme="blue" title="The lowest quote on this line, compared in PHP" />}
                            {cell.winner && <StatusBadge label="Winner" theme="green" />}
                          </div>
                          <div className="flex flex-wrap items-center gap-1">
                            {(editable || cell.quoted) && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                aria-expanded={isOpen}
                                aria-label={`Details, ${tag}`}
                                onClick={() => setOpenCell(isOpen ? null : { lineId: line.id, supplierId: supplier.id })}
                                className="h-7 px-2 text-xs"
                              >
                                Details
                              </Button>
                            )}
                            {canEdit &&
                              (cell.winner ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={line.locked}
                                  title={line.locked ? blocked ?? undefined : undefined}
                                  aria-label={`Un-pick ${supplier.name} on ${item.name}`}
                                  onClick={() => attempt(() => canvassService.clearWinner(line.id), "Winner cleared.")}
                                  className="h-7 px-2 text-xs"
                                >
                                  Un-pick
                                </Button>
                              ) : (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={Boolean(blocked)}
                                  title={blocked ?? undefined}
                                  aria-label={`Pick ${tag}`}
                                  onClick={() => ask({ kind: "pick", line, supplier })}
                                  className="h-7 px-2 text-xs"
                                >
                                  Pick
                                </Button>
                              ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {line.winner && (
                    <div role="row" className="col-span-full">
                      <div className="sticky left-0 max-w-[calc(100vw-4rem)]">
                        <div className={LINER} data-testid="winner-liner">
                          <div className="min-w-[10rem]">
                            <Caption>Winner</Caption>
                            <p className="text-sm font-semibold text-foreground">{line.winner.supplier?.name ?? supplierNameOf(line.winner.supplierId)}</p>
                          </div>
                          <Labeled caption="Why" required className="basis-72">
                            <Cell
                              label={`Reason, ${item.name}`}
                              noun="The reason"
                              value={line.winner.reason}
                              readOnly={!editable}
                              placeholder="Why this supplier"
                              onSave={(value) => {
                                if (!String(value ?? "").trim()) throw new Error("A winner needs a reason.");
                                return strict(() => canvassService.setWinnerReason(line.id, value));
                              }}
                            />
                          </Labeled>
                          <Projection projection={projectionOf(line, winnerCell)} label="Winner would give" />
                        </div>
                      </div>
                    </div>
                  )}

                  {openHere && openCellData && (
                    <div role="row" className="col-span-full">
                      <div className="sticky left-0 max-w-[calc(100vw-4rem)]">
                        <CellLiner
                          line={line}
                          supplier={openHere}
                          cell={openCellData}
                          editable={editable}
                          save={(patch) => saveQuote(line, openHere, patch)}
                          onRemove={() => attempt(() => canvassService.removeQuote(openCellData.quote.id), "Quote removed.")}
                          onClose={() => setOpenCell(null)}
                          projection={projectionOf(line, openCellData)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {supplierDialog && (
        <CanvassSupplierDialog
          key={supplierDialog.supplier?.id ?? "new"}
          open
          onOpenChange={(open) => !open && setSupplierDialog(null)}
          supplier={supplierDialog.supplier ?? null}
          canReadMoney={canReadMoney || !canvass}
          onSubmit={async (values) => {
            if (supplierDialog.supplier) {
              await canvassService.updateSupplier(supplierDialog.supplier.id, values);
              toast.success(`${values.supplierName} saved.`);
            } else {
              const started = await canvassService.addSupplier(requestId, values, actorId);
              toast.success(canvass ? `${values.supplierName} added.` : `Canvass ${started.number} started.`);
            }
            refresh();
          }}
        />
      )}

      {reasonFor && reasonCopy && (
        <CanvassReasonDialog
          key={`${reasonFor.kind}-${reasonFor.line?.id ?? ""}-${reasonFor.supplier?.id ?? ""}`}
          open
          onOpenChange={(open) => !open && setReasonFor(null)}
          placeholder="One line is enough."
          onSubmit={submitReason}
          {...reasonCopy}
        />
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remove ${removing?.name ?? "this supplier"}?`}
        description={`Its quotes on ${unitCount(lines.length, "line")}, and any win they held, go with it.`}
        confirmLabel="Remove"
        tone="destructive"
        onConfirm={async () => {
          await attempt(() => canvassService.removeSupplier(removing.id), `${removing.name} removed.`);
          setRemoving(null);
        }}
      />
      <ConfirmDialog
        open={clearingNote}
        onOpenChange={setClearingNote}
        title="Remove the “No other supplier” note?"
        description="The database refuses while a winner depends on it."
        confirmLabel="Remove note"
        tone="destructive"
        onConfirm={async () => {
          await attempt(() => canvassService.clearNoOtherSupplier(canvass.id), "Note removed.");
          setClearingNote(false);
        }}
      />
    </div>
  );
}

/**
 * The Canvass in the wide `ModalShell`, expandable; on a phone it fills the screen. `focusItemId`
 * opens it at that line (the line's notes column says where its Canvass stands and opens it here).
 */
export function CanvassGridModal({ open, onOpenChange, request, focusItemId = null }) {
  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      size="wide"
      expandable
      crumbs={["Canvass", request?.title || "Purchase Request"].filter(Boolean)}
      title="Canvass"
      cancelLabel="Close"
      className="max-md:!top-0 max-md:!left-0 max-md:!h-dvh max-md:!max-h-dvh max-md:!w-screen max-md:!max-w-none max-md:!translate-x-0 max-md:!translate-y-0 max-md:rounded-none"
    >
      <CanvassGrid request={request} focusItemId={focusItemId} />
    </ModalShell>
  );
}
