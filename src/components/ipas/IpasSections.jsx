import { Check, CircleAlert, CloudDownload, CloudOff, Pencil, RefreshCw, Undo2 } from "lucide-react";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { DetailRow } from "../ui/DetailParts";
import SectionHeader from "../ui/SectionHeader";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import StatusBadge from "../StatusBadge";
import {
  IPAS_COMPUTATION_STATUS_LABELS,
  IPAS_ERROR,
  IPAS_EVENT_LABELS,
  IPAS_HEADER_FIELD,
  IPAS_STATUS_SOURCE,
  IPAS_SUPPLIER_ORIGIN_FIELDS,
  IPAS_TICK_SIDE_LABELS,
  IPAS_TYPED_STATUS_LABELS,
  IPAS_LANDED_COST_SPLIT_LABELS,
  IPAS_OVERRIDE,
  IPAS_PAYMENT_KIND_LABELS,
  IPAS_PRIORITY_LABELS,
  IPAS_PURPOSE_LABELS,
  IPAS_SIGNOFF_ROLE_LABELS,
  IPAS_SOURCE_LABELS,
  IPAS_WARNING,
  ODOO_PO_STATE_LABELS,
  ipasSectionLabel,
} from "../../constants/ipas";
import { changeNoteSummary, formatAmount } from "../../utils/ipas";
import { buildBuyerTrack } from "../../utils/ipasDocuments";
import { formatDay } from "../../utils/ipasPayments";
import { formatDate } from "../../utils/formatDate.js";
import { useInDrawer } from "./record/sectionChrome";

/** One numbered section of the IPAS, as the sheet draws it. */
export function IpasSection({ title, aside, children }) {
  // In the drawer the drawer header already names the section: no card frame, no title.
  const inDrawer = useInDrawer();
  if (inDrawer) {
    return (
      <section>
        {aside && <div className="mb-3 text-xs text-muted-foreground">{aside}</div>}
        {children}
      </section>
    );
  }
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {aside && <div className="text-xs text-muted-foreground">{aside}</div>}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

/** The mark every value read from Odoo carries (the printed form's "● Odoo"). */
export function OdooMark({ children = "Odoo" }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
      <span className="size-1.5 rounded-full bg-blue-9" aria-hidden="true" />
      {children}
    </span>
  );
}

function Facts({ children }) {
  return <dl className="grid grid-cols-1 gap-x-8 divide-y divide-border sm:grid-cols-2 sm:divide-y-0">{children}</dl>;
}

/**
 * An Odoo value Purchasing may override (Entity, Source Doc., Analytic Dist.):
 * what the IPAS uses, with Odoo's current value beside an override and one
 * action to go back to it. `state` is one of `ipas.overrides`.
 */
function OverrideRow({ state, canChange, onEdit, onReset }) {
  return (
    <DetailRow label={state.label}>
      <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>{state.value ?? "—"}</span>
        {state.overridden ? (
          <>
            <StatusBadge theme="amber" label="Overridden" />
            <span className="text-xs font-normal text-muted-foreground">Odoo: {state.odoo ?? "blank"}</span>
          </>
        ) : (
          state.odoo !== null && <OdooMark />
        )}
        {canChange && (
          <span className="inline-flex items-center gap-1">
            <Button
              variant="ghost"
              size="xs"
              className="gap-1 text-muted-foreground"
              aria-label={`Override ${state.label}`}
              onClick={() => onEdit(state.field)}
            >
              <Pencil size={12} />
              Override
            </Button>
            {state.overridden && (
              <Button
                variant="ghost"
                size="xs"
                className="gap-1 text-muted-foreground"
                aria-label={`Reset ${state.label} to Odoo`}
                onClick={() => onReset(state.field)}
              >
                <Undo2 size={12} />
                Reset to Odoo
              </Button>
            )}
          </span>
        )}
      </span>
    </DetailRow>
  );
}

/**
 * A value Purchasing types and Odoo fills only while it is blank (supplier
 * contact, P.I #). `fromOdoo` marks a value that is still Odoo's.
 */
function TypedRow({ label, value, fromOdoo, canChange, onEdit }) {
  return (
    <DetailRow label={label}>
      <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>{value ?? "—"}</span>
        {fromOdoo && <OdooMark>Filled from Odoo</OdooMark>}
        {canChange && (
          <Button
            variant="ghost"
            size="xs"
            className="gap-1 text-muted-foreground"
            aria-label={`Edit ${label}`}
            onClick={onEdit}
          >
            <Pencil size={12} />
            Edit
          </Button>
        )}
      </span>
    </DetailRow>
  );
}

/**
 * Banners for what the stored copy says: a PO cancelled in Odoo (the IPAS stays
 * open), an S-number mismatch, a filed IPAS whose PO has since changed, and an
 * Odoo that didn't answer. None of them changes the IPAS.
 */
export function IpasWarnings({ ipas, refresh, onRetry, retrying = false }) {
  const banners = [];

  for (const warning of ipas.warnings ?? []) {
    if (warning.code === IPAS_WARNING.PO_CANCELLED_IN_ODOO) {
      banners.push({
        key: warning.code,
        tone: "red",
        title: "Odoo PO cancelled",
        body: "This IPAS stays open until Purchasing cancels it.",
      });
    } else if (warning.code === IPAS_WARNING.SOR_MISMATCH) {
      const parts = [];
      if (warning.onlyInOdoo.length) parts.push(`Odoo also names ${warning.onlyInOdoo.join(", ")}`);
      if (warning.onlyInIpas.length) parts.push(`Odoo doesn't name ${warning.onlyInIpas.join(", ")}`);
      banners.push({
        key: warning.code,
        tone: "amber",
        title: "Odoo's S numbers differ from this IPAS's SORs",
        body: `${parts.join("; ")}. Nothing has changed; check the SORs.`,
      });
    } else if (warning.code === IPAS_WARNING.ODOO_CHANGED_SINCE_FILING) {
      banners.push({
        key: warning.code,
        tone: "amber",
        title: "Odoo has changed since filing",
        body: "The filed copy below is unchanged.",
      });
    }
  }

  if (refresh && refresh.ok === false) {
    banners.push({
      key: "refresh",
      tone: "amber",
      icon: CloudOff,
      title:
        refresh.reason === IPAS_ERROR.PO_NOT_FOUND
          ? "This Odoo PO is no longer in Odoo"
          : refresh.reason === IPAS_ERROR.ODOO_UNAVAILABLE
            ? "Odoo didn't answer"
            : "The Odoo copy couldn't be refreshed",
      body: `Showing the last copy${refresh.fetchedAt ? `, fetched ${formatDate(refresh.fetchedAt)}` : ""}.`,
      retry: true,
    });
  }

  if (banners.length === 0) return null;

  return (
    <div className="space-y-2">
      {banners.map(({ key, tone, icon: Icon = CircleAlert, title, body, retry }) => (
        <div
          key={key}
          role="status"
          className={`flex flex-wrap items-start justify-between gap-3 rounded-xl border p-3 text-sm ${
            tone === "red" ? "border-red-400 bg-red-3/40 text-red-11" : "border-amber-400 bg-amber-3/40 text-amber-11"
          }`}
        >
          <div className="flex min-w-0 items-start gap-2">
            <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">{title}</p>
              <p className="mt-0.5 text-xs opacity-90">{body}</p>
            </div>
          </div>
          {/* The failed refresh keeps its banner and offers the same refresh again. */}
          {retry && onRetry && (
            <Button size="sm" variant="outline" className="shrink-0 gap-1.5 bg-card" disabled={retrying} onClick={onRetry}>
              <RefreshCw size={14} aria-hidden="true" className={retrying ? "animate-spin" : undefined} />
              {retrying ? "Retrying…" : "Retry"}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}

/** What changed in the PO since the previous copy: lines added, removed, quantity or price changed. */
export function IpasChangeNote({ note, currency }) {
  if (!note) return null;
  const money = (value) => formatAmount(value, currency);
  return (
    <div role="status" className="mb-3 rounded-lg border border-blue-400 bg-blue-3/40 p-3 text-[13px]">
      <p className="font-semibold text-blue-11">
        Odoo PO changed{note.at ? ` · ${formatDate(note.at)}` : ""}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{changeNoteSummary(note)}</p>
      <ul className="mt-2 space-y-1 text-xs text-foreground">
        {note.added.map((line) => (
          <li key={`a-${line.line_id}`}>
            <span className="font-semibold">Added</span> {line.name} · {line.quantity} × {money(line.price_unit)}
          </li>
        ))}
        {note.removed.map((line) => (
          <li key={`r-${line.line_id}`}>
            <span className="font-semibold">Removed</span> {line.name} · {line.quantity} × {money(line.price_unit)}
          </li>
        ))}
        {note.changed.map((line) => (
          <li key={`c-${line.line_id}`}>
            <span className="font-semibold">Changed</span> {line.name}
            {line.quantity_from !== line.quantity_to && (
              <>
                {" "}
                · quantity {line.quantity_from} → {line.quantity_to}
              </>
            )}
            {line.price_unit_from !== line.price_unit_to && (
              <>
                {" "}
                · price {money(line.price_unit_from)} → {money(line.price_unit_to)}
              </>
            )}
          </li>
        ))}
      </ul>
      {note.totalFrom !== note.totalTo && note.totalFrom !== null && (
        <p className="mt-2 text-xs text-muted-foreground">
          Total {money(note.totalFrom)} → {money(note.totalTo)}
        </p>
      )}
    </div>
  );
}

/** Header: Entity, Priority, Source, Purpose, who raised it and when. */
export function IpasHeaderSection({ ipas, canChange = false, onEditOverride, onResetOverride }) {
  return (
    <IpasSection title="Header">
      <Facts>
        <OverrideRow
          state={ipas.overrides[IPAS_OVERRIDE.ENTITY]}
          canChange={canChange}
          onEdit={onEditOverride}
          onReset={onResetOverride}
        />
        <DetailRow label="Priority">{IPAS_PRIORITY_LABELS[ipas.priority]}</DetailRow>
        <DetailRow label="Source">{IPAS_SOURCE_LABELS[ipas.source]}</DetailRow>
        <DetailRow label="Purpose">{IPAS_PURPOSE_LABELS[ipas.purpose]}</DetailRow>
        <DetailRow label="Date created">{formatDate(ipas.created_at)}</DetailRow>
        <DetailRow label="Created by">{ipas.creator?.name}</DetailRow>
        <DetailRow label="Remarks">{ipas.remarks}</DetailRow>
      </Facts>
    </IpasSection>
  );
}

const LINE_HEAD = "text-label font-bold uppercase tracking-wider";

/**
 * Section 1: the PO and its item lines, as Odoo had them when last fetched.
 * Currency, Supplier, item lines and Brand are read-only: a wrong one is fixed
 * on the PO in Odoo. Contact and P.I # are typed and kept.
 */
export function IpasPurchasingSection({ ipas, refreshing = false, canChange = false, onEditHeader, children }) {
  const copy = ipas.odoo_copy ?? {};
  const po = copy.po ?? {};
  const total = ipas.lines.reduce((sum, line) => sum + (Number(line.price_subtotal) || 0), 0);

  return (
    <IpasSection
      title={
        <span className="flex flex-wrap items-center gap-2">
          {ipasSectionLabel("purchasing")}
          <span className="font-mono text-xs font-semibold text-muted-foreground">{ipas.po_number}</span>
        </span>
      }
      aside={
        <span className="inline-flex items-center gap-1.5">
          {refreshing ? <RefreshCw size={12} className="animate-spin" /> : <CloudDownload size={12} />}
          Copy from Odoo, fetched {formatDate(ipas.odoo_fetched_at)}
          {refreshing && " · refreshing"}
        </span>
      }
    >
      <IpasChangeNote note={ipas.changeNote} currency={ipas.currency} />

      <Facts>
        <DetailRow label="Purchase Order">
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="font-mono">{po.name || ipas.po_number}</span>
            {po.state && (
              <StatusBadge
                theme={po.state === "cancel" ? "red" : "blue"}
                label={ODOO_PO_STATE_LABELS[po.state] || po.state}
              />
            )}
            <OdooMark />
          </span>
        </DetailRow>
        <DetailRow label="Currency">
          <span className="inline-flex items-center gap-2">
            <span className="font-mono">{ipas.currency}</span>
            <OdooMark>Odoo · fix on the Odoo PO</OdooMark>
          </span>
        </DetailRow>
        <DetailRow label="Supplier">
          <span className="inline-flex flex-wrap items-center gap-2">
            {ipas.supplier}
            <OdooMark />
          </span>
        </DetailRow>
        <TypedRow
          label="Contact"
          value={ipas.contact}
          fromOdoo={ipas.contactFromOdoo}
          canChange={canChange}
          onEdit={() => onEditHeader("supplier_contact")}
        />
        <TypedRow
          label="P.I #"
          value={ipas.piNumber}
          fromOdoo={ipas.piNumberFromOdoo}
          canChange={canChange}
          onEdit={() => onEditHeader("pi_number")}
        />
      </Facts>

      {ipas.lines.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">The Odoo PO has no item lines.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-border">
          <Table className="md:min-w-[40rem]">
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className={LINE_HEAD}>Item</TableHead>
                <TableHead className={LINE_HEAD}>Brand</TableHead>
                <TableHead className={`${LINE_HEAD} text-right`}>Qty</TableHead>
                <TableHead className={`${LINE_HEAD} text-right`}>Unit price</TableHead>
                <TableHead className={`${LINE_HEAD} text-right`}>Amount</TableHead>
                <TableHead className={LINE_HEAD}>Taxes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ipas.lines.map((line) => (
                <TableRow key={line.line_id}>
                  <TableCell className="max-w-[22rem] whitespace-pre-line text-[13px] text-foreground">
                    {line.name}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{line.brand || "—"}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {line.quantity} {line.unit}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {formatAmount(line.price_unit, ipas.currency)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs font-semibold tabular-nums">
                    {formatAmount(line.price_subtotal, ipas.currency)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {line.taxes?.length ? line.taxes.join(", ") : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex justify-between gap-3 border-t border-border bg-muted/20 px-4 py-2 text-xs">
            <span className="text-muted-foreground">Before tax, as Odoo prices the lines</span>
            <span className="font-mono font-semibold tabular-nums">{formatAmount(total, ipas.currency)}</span>
          </div>
        </div>
      )}

      {children}
    </IpasSection>
  );
}

/**
 * Section 2: the SORs it serves, the two plain ticks (Googlesheet, Gantt Chart,
 * #241), and Odoo's Source Document and analytic accounts.
 */
export function IpasSalesSection({ ipas, canChange = false, onEditOverride, onResetOverride, onTick }) {
  return (
    <IpasSection title={ipasSectionLabel("sales")}>
      <dl className="divide-y divide-border">
        <DetailRow label="SORs">
          {ipas.sors.length === 0 ? (
            <span className="text-muted-foreground">
              {ipas.isProject ? "No SOR named" : `None; ${IPAS_PURPOSE_LABELS[ipas.purpose]} names no SOR`}
            </span>
          ) : (
            <ul className="space-y-1">
              {ipas.sors.map((sor) => (
                <li key={sor.id} className="text-[13px]">
                  <span className="font-mono font-semibold">{sor.salesReference}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    · {sor.projectTitle}
                    {sor.stageName ? ` · ${sor.stageName}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </DetailRow>
        <DetailRow label="Googlesheet">
          <Checkbox
            checked={ipas.googleSheet}
            disabled={!canChange}
            aria-label="Googlesheet"
            onCheckedChange={(value) => onTick(IPAS_HEADER_FIELD.GOOGLE_SHEET, Boolean(value))}
          />
        </DetailRow>
        <DetailRow label="Gantt Chart">
          <Checkbox
            checked={ipas.ganttChart}
            disabled={!canChange}
            aria-label="Gantt Chart"
            onCheckedChange={(value) => onTick(IPAS_HEADER_FIELD.GANTT_CHART, Boolean(value))}
          />
        </DetailRow>
        <OverrideRow
          state={ipas.overrides[IPAS_OVERRIDE.SOURCE_DOC]}
          canChange={canChange}
          onEdit={onEditOverride}
          onReset={onResetOverride}
        />
        <OverrideRow
          state={ipas.overrides[IPAS_OVERRIDE.ANALYTIC]}
          canChange={canChange}
          onEdit={onEditOverride}
          onReset={onResetOverride}
        />
      </dl>
    </IpasSection>
  );
}

/** One buyer-track row's own mark: where the status came from. */
function SourceNote({ item }) {
  switch (item.source) {
    case IPAS_STATUS_SOURCE.ODOO:
      return <OdooMark>stamped from Odoo</OdooMark>;
    case IPAS_STATUS_SOURCE.DERIVED:
      return <span className="text-[11px] font-medium text-muted-foreground">derived from payments</span>;
    case IPAS_STATUS_SOURCE.TYPED:
      return (
        <span className="text-[11px] font-medium text-muted-foreground">
          {item.ticked
            ? `typed${item.by?.name ? ` by ${item.by.name}` : ""}${item.at ? ` · ${formatDate(item.at)}` : ""}`
            : "typed by Purchasing"}
        </span>
      );
    case IPAS_STATUS_SOURCE.STAMPED:
      return (
        <span className="text-[11px] font-medium text-muted-foreground">
          {item.ticked
            ? `stamped${item.by?.name ? ` by ${item.by.name}` : ""}${item.at ? ` · ${formatDate(item.at)}` : ""}`
            : "stamped by Purchasing"}
        </span>
      );
    default:
      return null;
  }
}

function TrackStatus({ item, canChange, onEdit, onStamp, onClearStamp }) {
  const { ticked, partial } = item;
  const detail = item.on ? formatDay(item.on) : item.detail;

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[13px]" data-testid={`ipas-track-${item.key}`}>
      <span
        className={`grid size-5 shrink-0 place-items-center rounded-full border ${
          ticked
            ? "border-green-400 bg-green-3/40 text-green-11"
            : partial
              ? "border-amber-400 bg-amber-3/40 text-amber-11"
              : "border-border text-transparent"
        }`}
        aria-hidden="true"
      >
        <Check size={12} strokeWidth={3} />
      </span>
      <span className="font-medium text-foreground">{item.label}</span>
      {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
      <span className="ml-auto inline-flex flex-wrap items-center gap-2">
        {canChange && item.source === IPAS_STATUS_SOURCE.TYPED && (
          <Button variant="ghost" size="xs" className="gap-1 text-muted-foreground" onClick={() => onEdit(item.key)}>
            <Pencil size={12} />
            {ticked ? "Edit date" : "Type date"}
          </Button>
        )}
        {canChange && item.source === IPAS_STATUS_SOURCE.STAMPED && (
          <Button
            variant="ghost"
            size="xs"
            className="gap-1 text-muted-foreground"
            onClick={ticked ? onClearStamp : onStamp}
          >
            {ticked ? <Undo2 size={12} /> : <Check size={12} />}
            {ticked ? "Clear stamp" : "Stamp"}
          </Button>
        )}
        <SourceNote item={item} />
      </span>
    </li>
  );
}

/** What Odoo says beside each Odoo-stamped status. */
function odooDetail(key, statuses) {
  const { purchaseOrder, receivedInOdoo, createBill } = statuses;
  if (key === "purchase_order") return ODOO_PO_STATE_LABELS[purchaseOrder.state] ?? null;
  if (key === "received_in_odoo") {
    const received = receivedInOdoo.ticked
      ? "Received"
      : receivedInOdoo.partial
        ? "Partly received"
        : receivedInOdoo.receiptsTotal > 0
          ? "Not received"
          : null;
    if (!received) return null;
    return receivedInOdoo.receiptsTotal > 0
      ? `${received} · ${receivedInOdoo.receiptsDone} of ${receivedInOdoo.receiptsTotal} receipts done`
      : received;
  }
  if (key === "create_bill") {
    if (!createBill.ticked) return null;
    return createBill.draftsOnly
      ? `${createBill.count} draft ${createBill.count === 1 ? "bill" : "bills"}`
      : `${createBill.count} ${createBill.count === 1 ? "bill" : "bills"}${createBill.drafts ? `, ${createBill.drafts} in draft` : ""}`;
  }
  return null;
}

/**
 * Supplier Origin: four typed dates, shown only on an Import IPAS (a Local
 * IPAS has no such block, and the database refuses the dates there).
 */
function SupplierOrigin({ ipas, canChange, onEdit }) {
  const origin = ipas.supplierOrigin;
  if (!origin) return null;

  return (
    <div className="space-y-2" data-testid="ipas-supplier-origin">
      <SectionHeader title="Supplier Origin" className="pb-2">
        {canChange && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onEdit}>
            <Pencil size={14} />
            Edit dates
          </Button>
        )}
      </SectionHeader>
      <dl className="grid grid-cols-1 gap-x-8 divide-y divide-border sm:grid-cols-2 sm:divide-y-0">
        {IPAS_SUPPLIER_ORIGIN_FIELDS.map(({ field, label }) => (
          <DetailRow key={field} label={label}>
            {origin[field] ? formatDay(origin[field]) : null}
          </DetailRow>
        ))}
      </dl>
    </div>
  );
}

/**
 * Section 6, Status: Supplier Origin (Import only) and the buyer track. Each
 * status says where it came from: the three Odoo ones are stamped from Odoo and
 * can't be ticked by hand, With P.O.P is derived from the payments, Import
 * Clearance (Import only) and Delivered are typed, and Actual Checking is
 * stamped by Purchasing, the last three showing who and when.
 *
 *   canChange   Purchasing on an open IPAS: types the dates and stamps
 */
export function IpasStatusSection({ ipas, canChange = false, onEditOrigin, onEditStatus, onStamp, onClearStamp }) {
  const track = ipas.buyerTrack ?? buildBuyerTrack(ipas, ipas.statuses);

  return (
    <IpasSection title={ipasSectionLabel("status")} aside="Each status shows where it came from.">
      <div className="space-y-4">
        <SupplierOrigin ipas={ipas} canChange={canChange} onEdit={onEditOrigin} />
        <div>
          <SectionHeader title="Buyer track" className="pb-2" />
          <ul className="mt-1 divide-y divide-border">
            {track.map((item) => (
              <TrackStatus
                key={item.key}
                item={{ ...item, detail: item.source === IPAS_STATUS_SOURCE.ODOO ? odooDetail(item.key, ipas.statuses) : item.detail }}
                canChange={canChange}
                onEdit={onEditStatus}
                onStamp={onStamp}
                onClearStamp={onClearStamp}
              />
            ))}
          </ul>
        </div>
      </div>
    </IpasSection>
  );
}

const OVERRIDE_FIELD_NAMES = {
  entity: "Entity",
  source_doc: "Source Doc.",
  analytic: "Analytic Dist.",
};

const HEADER_FIELD_NAMES = {
  supplier_contact: "Contact",
  pi_number: "P.I #",
  pi_qt_amount: "P.I/QT Amount",
  freight_service_id: "Freight service",
  landed_cost_split: "Landed Cost spread",
  computation_status: "Computation status",
  google_sheet: "Googlesheet",
  gantt_chart: "Gantt Chart",
};

const BANK_FIELD_NAMES = {
  bank_name: "Bank Name",
  account_name: "Account Name",
  account_number: "Account #",
};

const PAYMENT_FIELD_NAMES = {
  kind: "kind",
  paid_on: "date",
  amount: "amount",
  php_debited: "PHP debited",
  charge_fee_php: "charge fee",
  method: "method",
  check_no: "Check No.",
  proof: "proof",
  charged_on: "date",
  amount_php: "amount",
};

/** One header change as words: the value it became. */
function headerChangeText(field, change) {
  const to = change?.to;
  if (typeof to === "boolean") return `${HEADER_FIELD_NAMES[field] ?? field}: ${to ? "ticked" : "not ticked"}`;
  if (to === null || to === undefined || to === "") return `${HEADER_FIELD_NAMES[field] ?? field}: cleared`;
  if (field === "pi_qt_amount") return `${HEADER_FIELD_NAMES[field]}: ${formatAmount(to, null)}`;
  if (field === "landed_cost_split") {
    return `${HEADER_FIELD_NAMES[field]}: ${IPAS_LANDED_COST_SPLIT_LABELS[to] ?? to}`;
  }
  if (field === "computation_status") {
    return `${HEADER_FIELD_NAMES[field]}: ${IPAS_COMPUTATION_STATUS_LABELS[to] ?? to}`;
  }
  return `${HEADER_FIELD_NAMES[field] ?? field}: “${to}”`;
}

const money = (value) => formatAmount(value, null);

/** What a payment or charge event says beside its label, from the snapshot it kept. */
function moneyEventDetail(event) {
  const d = event.detail ?? {};
  const kind = IPAS_PAYMENT_KIND_LABELS[d.kind] ?? d.kind ?? null;
  const currency = d.currency ? `${d.currency} ` : "";
  switch (event.kind) {
    case "payment_added":
    case "payment_removed": {
      const parts = [kind, d.amount != null ? `${currency}${money(d.amount)}` : null];
      if (d.php_debited != null) parts.push(`PHP ${money(d.php_debited)} debited`);
      if (d.method) parts.push(d.method);
      return parts.filter(Boolean).join(" · ");
    }
    case "payment_changed": {
      const changed = Object.keys(d.changes ?? {}).map((key) => PAYMENT_FIELD_NAMES[key] ?? key);
      return [kind, changed.length ? `changed ${changed.join(", ")}` : null].filter(Boolean).join(" · ");
    }
    case "charge_added":
    case "charge_removed":
      return [d.kind, d.amount_php != null ? `PHP ${money(d.amount_php)}` : null].filter(Boolean).join(" · ");
    case "charge_changed": {
      const changed = Object.keys(d.changes ?? {}).map((key) => PAYMENT_FIELD_NAMES[key] ?? key);
      return [d.kind, changed.length ? `changed ${changed.join(", ")}` : null].filter(Boolean).join(" · ");
    }
    default:
      return null;
  }
}

/** The one line a history row adds beside its label, or null. */
function eventDetail(event) {
  const detail = event.detail ?? {};
  switch (event.kind) {
    case "cancelled":
      return detail.reason ? `“${detail.reason}”` : null;
    case "override_set":
      return `${OVERRIDE_FIELD_NAMES[detail.field] ?? detail.field}: “${detail.to}”${detail.odoo ? ` (Odoo: ${detail.odoo})` : ""}`;
    case "override_reset":
      return `${OVERRIDE_FIELD_NAMES[detail.field] ?? detail.field} back to Odoo${detail.odoo ? `: ${detail.odoo}` : ""}`;
    case "header_changed":
      return Object.entries(detail.fields ?? {})
        .map(([field, change]) => headerChangeText(field, change))
        .join("; ");
    case "filled_from_odoo":
      return (detail.fields ?? []).map((field) => HEADER_FIELD_NAMES[field] ?? field).join(", ");
    case "odoo_copy_changed": {
      const note = detail.note;
      if (!note) {
        return detail.po_state_to ? `Odoo PO is now ${ODOO_PO_STATE_LABELS[detail.po_state_to] ?? detail.po_state_to}` : null;
      }
      const parts = [];
      if (note.added?.length) parts.push(`${note.added.length} added`);
      if (note.removed?.length) parts.push(`${note.removed.length} removed`);
      if (note.changed?.length) parts.push(`${note.changed.length} changed`);
      return parts.join(", ") || null;
    }
    case "approvals_cleared": {
      const sections = (detail.sections ?? []).map((s) => ipasSectionLabel(s)).join(" and ");
      return [detail.reason, sections ? `${sections} back to awaiting approval` : null].filter(Boolean).join(" · ") || null;
    }
    case "signed":
      return [
        `Section ${ipasSectionLabel(detail.section)} ${IPAS_SIGNOFF_ROLE_LABELS[detail.role]?.toLowerCase() ?? detail.role}`,
        detail.signature_declined ? "without a signature" : null,
      ]
        .filter(Boolean)
        .join(" · ");
    case "sent_back":
      return [`Section ${ipasSectionLabel(detail.section)}`, detail.reason ? `“${detail.reason}”` : null].filter(Boolean).join(" · ");
    case "filed":
      return `Section ${ipasSectionLabel("filing")} approved · ${IPAS_COMPUTATION_STATUS_LABELS[detail.computation_status] ?? "Costs complete"}`;
    case "reopened": {
      const cleared = (detail.cleared ?? []).map((role) => IPAS_SIGNOFF_ROLE_LABELS[role]?.toLowerCase() ?? role);
      return [
        detail.reason ? `“${detail.reason}”` : null,
        cleared.length ? `cleared section ${ipasSectionLabel("filing")}: ${cleared.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    case "odoo_changed_since_filing": {
      const note = detail.note;
      if (!note) return null;
      const parts = [];
      if (note.added?.length) parts.push(`${note.added.length} added`);
      if (note.removed?.length) parts.push(`${note.removed.length} removed`);
      if (note.changed?.length) parts.push(`${note.changed.length} changed`);
      return parts.join(", ") || null;
    }
    case "bank_details_set":
    case "bank_details_changed": {
      // Which fields, never the values: the history is wider than bank details.
      const names = (detail.fields ?? []).map((field) => BANK_FIELD_NAMES[field] ?? field);
      const parts = [names.length ? `${event.kind === "bank_details_set" ? "typed" : "changed"} ${names.join(", ")}` : null];
      if (detail.flagged) parts.push("flagged");
      else if (detail.was_flagged) parts.push("flag cleared");
      return parts.filter(Boolean).join(" · ") || null;
    }
    case "account_flagged":
      return "Differs from this supplier's last IPAS";
    case "documents_suggested":
      return (detail.labels ?? []).join(", ") || null;
    case "document_added":
      return [detail.label, detail.by_hand ? "added by hand" : null].filter(Boolean).join(" · ");
    case "document_ticked": {
      const side = IPAS_TICK_SIDE_LABELS[detail.side] ?? detail.side;
      return `${detail.label}: ${side} ${detail.value ? "ticked" : "unticked"}`;
    }
    case "document_attachment_set":
    case "document_attachment_removed":
    case "document_removed":
      return detail.label ?? null;
    case "supplier_origin_changed":
      return Object.entries(detail.fields ?? {})
        .map(([column, change]) => {
          const name = IPAS_SUPPLIER_ORIGIN_FIELDS.find((f) => f.column === column)?.label ?? column;
          return change?.to ? `${name}: ${formatDay(change.to)}` : `${name}: cleared`;
        })
        .join("; ");
    case "status_typed":
    case "status_cleared": {
      const name = IPAS_TYPED_STATUS_LABELS[detail.status] ?? detail.status;
      return detail.to ? `${name}: ${formatDay(detail.to)}` : `${name}: cleared`;
    }
    case "item_location_changed":
      return detail.to ? `Item Location: ${detail.to}` : "Item Location: cleared";
    case "payment_added":
    case "payment_changed":
    case "payment_removed":
    case "charge_added":
    case "charge_changed":
    case "charge_removed":
      return moneyEventDetail(event);
    default:
      return null;
  }
}

/** Every change to the IPAS, oldest first. Nobody can edit or delete it. */
export function IpasHistorySection({ events }) {
  return (
    <IpasSection title="History" aside="Kept as it happened; nobody can edit it.">
      {events.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <ol className="divide-y divide-border">
          {events.map((event) => {
            const detail = eventDetail(event);
            return (
              <li key={event.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-[13px]">
                <span className="font-medium text-foreground">{IPAS_EVENT_LABELS[event.kind] || event.kind}</span>
                {detail && <span className="text-muted-foreground">{detail}</span>}
                <span className="ml-auto text-xs text-muted-foreground">
                  {event.actor?.name ? `${event.actor.name} · ` : ""}
                  {formatDate(event.created_at)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </IpasSection>
  );
}
