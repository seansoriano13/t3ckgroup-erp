import { CloudDownload } from "lucide-react";

import { DetailRow } from "../ui/DetailParts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import StatusBadge from "../StatusBadge";
import {
  IPAS_EVENT_LABELS,
  IPAS_PRIORITY_LABELS,
  IPAS_PURPOSE_LABELS,
  IPAS_SOURCE_LABELS,
  ODOO_PO_STATE_LABELS,
} from "../../constants/ipas";
import { analyticNames, formatAmount } from "../../utils/ipas";
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

/** Header: Entity, Priority, Source, Purpose, who raised it and when. */
export function IpasHeaderSection({ ipas }) {
  return (
    <IpasSection title="Header">
      <Facts>
        <DetailRow label="Entity">{ipas.entity}</DetailRow>
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

/** Section 1: the PO and its item lines, as Odoo had them when last fetched. */
export function IpasPurchasingSection({ ipas }) {
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
          <CloudDownload size={12} />
          Copy from Odoo, fetched {formatDate(ipas.odoo_fetched_at)}
        </span>
      }
    >
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
            <OdooMark />
          </span>
        </DetailRow>
        <DetailRow label="Supplier">
          <span className="inline-flex flex-wrap items-center gap-2">
            {ipas.supplier}
            <OdooMark />
          </span>
        </DetailRow>
        <DetailRow label="Contact">{copy.supplier?.contact}</DetailRow>
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
    </IpasSection>
  );
}

/** Section 2: the customers and SORs it serves, and Odoo's Source Document and analytic accounts. */
export function IpasSalesSection({ ipas }) {
  const analytic = analyticNames(ipas.odoo_copy);
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
        <DetailRow label="Source Doc. Odoo">
          {ipas.odoo_copy?.po?.origin ? (
            <span className="inline-flex flex-wrap items-center gap-2">
              {ipas.odoo_copy.po.origin}
              <OdooMark />
            </span>
          ) : null}
        </DetailRow>
        <DetailRow label="Analytic Dist.">
          {analytic.length ? (
            <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
              {analytic.join(" · ")}
              <OdooMark />
            </span>
          ) : null}
        </DetailRow>
      </dl>
    </IpasSection>
  );
}

/** Every change to the IPAS, oldest first. Nobody can edit or delete it. */
export function IpasHistorySection({ events }) {
  return (
    <IpasSection title="History" aside="Kept as it happened; nobody can edit it.">
      {events.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <ol className="divide-y divide-border">
          {events.map((event) => (
            <li key={event.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 text-[13px]">
              <span className="font-medium text-foreground">{IPAS_EVENT_LABELS[event.kind] || event.kind}</span>
              {event.kind === "cancelled" && event.detail?.reason && (
                <span className="text-muted-foreground">“{event.detail.reason}”</span>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {event.actor?.name ? `${event.actor.name} · ` : ""}
                {formatDate(event.created_at)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </IpasSection>
  );
}
