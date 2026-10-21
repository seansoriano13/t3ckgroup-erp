import { TableCell, TableRow } from "../ui/table";
import { formatDate } from "../../utils/formatDate.js";
import {
  IPAS_COMPUTATION_STATUS,
  IPAS_COMPUTATION_STATUS_LABELS,
  IPAS_PRIORITY_LABELS,
  IPAS_PURPOSE_LABELS,
  IPAS_SOURCE_LABELS,
  IPAS_STATE,
} from "../../constants/ipas";
import { formatAmount, raisedByParts, sorLineParts } from "../../utils/ipas";
import HighlightText from "../HighlightText";
import { IPAS_AMOUNT_SOURCE } from "../../utils/ipasFigures";
import IpasStateBadge from "./IpasStateBadge";
import IpasStatusControl from "./IpasStatusControl";

const AMOUNT_SOURCE_NOTE = {
  [IPAS_AMOUNT_SOURCE.PI_QT]: "P.I/QT",
  [IPAS_AMOUNT_SOURCE.ODOO_PO]: "Odoo PO",
};

/** A down or full payment total: blank when none was recorded. */
const paymentTotal = (value, currency) => (value > 0 ? formatAmount(value, currency) : "—");

/**
 * The sheet's money columns (#596): Amount (and which figure it is), Payment
 * scheme, DP, FP and Remaining balance, each in the PO's currency. Read from
 * the IPAS figures; nothing is worked out here.
 */
function IpasMoneyCells({ figures }) {
  const { currency, amount, amountSource, amountBeforeTax, paymentScheme, downPayment, fullPayment, remainingBalance } =
    figures;
  const money = "text-right text-xs tabular-nums text-foreground";
  return (
    <>
      <TableCell className="text-right">
        <span className={`block ${money}`} data-testid="ipas-row-amount">
          {amount === null ? "—" : formatAmount(amount, currency)}
        </span>
        {amountSource && (
          <span className="mt-0.5 block text-[11px] text-muted-foreground" data-testid="ipas-row-amount-source">
            {AMOUNT_SOURCE_NOTE[amountSource]}
            {amountBeforeTax ? " · before tax" : ""}
          </span>
        )}
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <span className="block max-w-[12rem] truncate text-xs text-foreground" data-testid="ipas-row-scheme">
          {paymentScheme || "—"}
        </span>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <span className={`block ${money}`} data-testid="ipas-row-dp">
          {paymentTotal(downPayment, currency)}
        </span>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <span className={`block ${money}`} data-testid="ipas-row-fp">
          {paymentTotal(fullPayment, currency)}
        </span>
      </TableCell>
      <TableCell className="text-right">
        <span className={`block ${money}`} data-testid="ipas-row-remaining">
          {remainingBalance === null ? "—" : formatAmount(remainingBalance, currency)}
        </span>
      </TableCell>
    </>
  );
}

/**
 * One row of the IPAS list. The whole row opens the IPAS (click, or Enter on
 * the focused row); Supplier, Entity, Project / SO, Raised and Raised by hide
 * below md so the number, Purpose and State stay in view. `search` is the
 * list's search text: where it matches, the text is highlighted.
 */
export default function IpasRow({ row, onOpen, search = "", canSetHold = false }) {
  const raisedBy = raisedByParts(row);
  const term = search.trim().toLowerCase();

  return (
    <TableRow
      tabIndex={0}
      data-testid="ipas-row"
      onClick={() => onOpen(row.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) {
          e.preventDefault();
          onOpen(row.id);
        }
      }}
      className={`group cursor-pointer outline-none focus-visible:bg-muted ${row.state === IPAS_STATE.CANCELLED ? "opacity-70" : ""}`}
    >
      <TableCell>
        <span className="block font-mono text-xs font-semibold text-foreground">
          <HighlightText text={row.number} search={search} />
        </span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">
          {IPAS_PRIORITY_LABELS[row.priority]} · {IPAS_SOURCE_LABELS[row.source]}
        </span>
      </TableCell>
      <TableCell>
        <span className="font-mono text-xs text-foreground">
          <HighlightText text={row.po_number} search={search} />
        </span>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <span className="block max-w-[16rem] truncate text-xs text-foreground">
          {row.supplier ? <HighlightText text={row.supplier} search={search} /> : "—"}
        </span>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <span className="text-xs text-muted-foreground">{row.entity || "—"}</span>
      </TableCell>
      <TableCell>
        <span className="text-xs font-medium text-foreground">{IPAS_PURPOSE_LABELS[row.purpose]}</span>
      </TableCell>
      <TableCell>
        <span className="text-xs text-foreground" data-testid="ipas-row-costing">
          {IPAS_COMPUTATION_STATUS_LABELS[row.computation_status || IPAS_COMPUTATION_STATUS.ENCODING] ?? "—"}
        </span>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        {row.sors.length === 0 ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <ul className="space-y-0.5" data-testid="ipas-row-sors">
            {row.sors.map((sor) => {
              const { reference, project } = sorLineParts(sor);
              // A line leads with the SO number; when the search is the SOR number
              // of an SOR that has an SO number, the SOR number is shown so the match is visible.
              const showSorCode = Boolean(sor.salesReference && sor.sorCode && term && sor.sorCode.toLowerCase().includes(term));
              return (
                <li key={sor.id} className="max-w-[20rem] truncate text-xs text-foreground">
                  <span className="font-mono">{reference ? <HighlightText text={reference} search={search} /> : "—"}</span>
                  {project && (
                    <>
                      {" · "}
                      <HighlightText text={project} search={search} />
                    </>
                  )}
                  {showSorCode && (
                    <span className="ml-1 font-mono text-muted-foreground">
                      (<HighlightText text={sor.sorCode} search={search} />)
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <span className="text-xs tabular-nums text-muted-foreground">{formatDate(row.created_at)}</span>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        {raisedBy ? (
          <span className="block max-w-[14rem] truncate text-xs text-foreground" data-testid="ipas-row-raised-by">
            {raisedBy.callSign ? `${raisedBy.callSign} · ${raisedBy.name}` : raisedBy.name}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <IpasMoneyCells figures={row.figures} />
      <TableCell>
        <IpasStatusControl ipas={row} figures={row.figures} canSet={canSetHold} />
      </TableCell>
      <TableCell className="text-right">
        <IpasStateBadge state={row.state} />
      </TableCell>
    </TableRow>
  );
}
