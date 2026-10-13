import { Check, CircleAlert, CloudDownload, CloudOff, Pencil, RefreshCw, Undo2 } from "lucide-react";

import { Button } from "../ui/button";
import { DetailRow } from "../ui/DetailParts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import StatusBadge from "../StatusBadge";
import {
  IPAS_COMPUTATION_STATUS_LABELS,
  IPAS_ERROR,
  IPAS_EVENT_LABELS,
  IPAS_LANDED_COST_SPLIT_LABELS,
  IPAS_OVERRIDE,
  IPAS_PAYMENT_KIND_LABELS,
  IPAS_PRIORITY_LABELS,
  IPAS_PURPOSE_LABELS,
  IPAS_SOURCE_LABELS,
  IPAS_WARNING,
  ODOO_PO_STATE_LABELS,
} from "../../constants/ipas";
import { changeNoteSummary, formatAmount } from "../../utils/ipas";
import { formatDate } from "../../utils/formatDate.js";

/** One numbered section of the IPAS, as the sheet draws it. */
export function IpasSection({ title, aside, children }) {
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
export function IpasWarnings({ ipas, refresh }) {
  const banners = [];

  for (const warning of ipas.warnings ?? []) {
    if (warning.code === IPAS_WARNING.PO_CANCELLED_IN_ODOO) {
      banners.push({
        key: warning.code,
        tone: "red",
        title: "PO cancelled in Odoo",
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
          ? "Odoo no longer has this PO"
          : refresh.reason === IPAS_ERROR.ODOO_UNAVAILABLE
            ? "Odoo didn't answer"
            : "The Odoo copy couldn't be refreshed",
      body: `Showing the last copy${refresh.fetchedAt ? `, fetched ${formatDate(refresh.fetchedAt)}` : ""}.`,
    });
  }

  if (banners.length === 0) return null;

  return (
    <div className="space-y-2">
      {banners.map(({ key, tone, icon: Icon = CircleAlert, title, body }) => (
        <div
          key={key}
          role="status"
          className={`flex items-start gap-2 rounded-xl border p-3 text-[13px] ${
            tone === "red" ? "border-red-400 bg-red-3/40 text-red-11" : "border-amber-400 bg-amber-3/40 text-amber-11"
          }`}
        >
          <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">{title}</p>
            <p className="mt-0.5 text-xs opacity-90">{body}</p>
          </div>
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
        PO changed in Odoo{note.at ? ` · ${formatDate(note.at)}` : ""}
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

const LINE_HEAD = "text-[10px] font-bold uppercase tracking-wider";

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
          1 · Purchasing
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
            <OdooMark>Odoo · fix on the PO</OdooMark>
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
        <p className="py-4 text-sm text-muted-foreground">The PO has no item lines.</p>
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
                  <TableCell className="text-right text-xs tabular-nums">
                    {line.quantity} {line.unit}
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {formatAmount(line.price_unit, ipas.currency)}
                  </TableCell>
                  <TableCell className="text-right text-xs font-semibold tabular-nums">
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
            <span className="font-semibold tabular-nums">{formatAmount(total, ipas.currency)}</span>
          </div>
        </div>
      )}

      {children}
    </IpasSection>
  );
}

/** Section 2: the customers and SORs it serves, and Odoo's Source Document and analytic accounts. */
export function IpasSalesSection({ ipas, canChange = false, onEditOverride, onResetOverride }) {
  return (
    <IpasSection title="2 · Sales & Operation">
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
                    {sor.clientName ? ` · ${sor.clientName}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
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

function StampedStatus({ label, ticked, partial = false, detail }) {
  return (
    <li className="flex items-center gap-3 py-2 text-[13px]">
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
      <span className="font-medium text-foreground">{label}</span>
      {detail && <span className="text-xs text-muted-foreground">{detail}</span>}
      <span className="ml-auto">
        <OdooMark>stamped from Odoo</OdooMark>
      </span>
    </li>
  );
}

/**
 * Section 6, the Odoo-stamped part of the buyer track: Purchase Order, Received
 * in Odoo ("Partly received" while only some receipts are done) and Create Bill
 * (drafts count). They are read from the copy and can't be ticked by hand. The
 * typed and other stamped statuses join them in the buyer-track ticket.
 */
export function IpasStatusSection({ ipas }) {
  const { purchaseOrder, receivedInOdoo, createBill } = ipas.statuses;

  const received = receivedInOdoo.ticked
    ? "Received"
    : receivedInOdoo.partial
      ? "Partly received"
      : receivedInOdoo.receiptsTotal > 0
        ? "Not received"
        : null;

  return (
    <IpasSection title="6 · Status" aside="Read from the copy of the Odoo PO; never ticked by hand.">
      <ul className="divide-y divide-border">
        <StampedStatus
          label="Purchase Order"
          ticked={purchaseOrder.ticked}
          detail={ODOO_PO_STATE_LABELS[purchaseOrder.state] ?? null}
        />
        <StampedStatus
          label="Received in Odoo"
          ticked={receivedInOdoo.ticked}
          partial={receivedInOdoo.partial}
          detail={
            received
              ? receivedInOdoo.receiptsTotal > 0
                ? `${received} · ${receivedInOdoo.receiptsDone} of ${receivedInOdoo.receiptsTotal} receipts done`
                : received
              : null
          }
        />
        <StampedStatus
          label="Create Bill"
          ticked={createBill.ticked}
          detail={
            createBill.ticked
              ? createBill.draftsOnly
                ? `${createBill.count} draft ${createBill.count === 1 ? "bill" : "bills"}`
                : `${createBill.count} ${createBill.count === 1 ? "bill" : "bills"}${createBill.drafts ? `, ${createBill.drafts} in draft` : ""}`
              : null
          }
        />
      </ul>
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
        return detail.po_state_to ? `PO is now ${ODOO_PO_STATE_LABELS[detail.po_state_to] ?? detail.po_state_to}` : null;
      }
      const parts = [];
      if (note.added?.length) parts.push(`${note.added.length} added`);
      if (note.removed?.length) parts.push(`${note.removed.length} removed`);
      if (note.changed?.length) parts.push(`${note.changed.length} changed`);
      return parts.join(", ") || null;
    }
    case "approvals_cleared":
      return detail.reason ?? null;
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
