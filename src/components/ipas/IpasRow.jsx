import { TableCell, TableRow } from "../ui/table";
import { listDate } from "../../utils/listDates.js";
import { cellsInOrder } from "../../utils/columnOrder";
import { IdentityText } from "../purchasing/list/IdentityCell";
import {
  IPAS_COMPUTATION_STATUS,
  IPAS_ASK_PRIORITY_LABELS,
  IPAS_COMPUTATION_STATUS_LABELS,
  IPAS_PURPOSE_LABELS,
  IPAS_STATE,
} from "../../constants/ipas";
import { formatAmount, raisedByParts, sorLineParts } from "../../utils/ipas";
import HighlightText from "../HighlightText";
import { matchesSorCode } from "../../utils/sorSearch";
import { IPAS_AMOUNT_SOURCE } from "../../utils/ipasFigures";
import IpasStateBadge from "./IpasStateBadge";
import IpasStatusControl from "./IpasStatusControl";
import IpasPaymentStatusPill from "./IpasPaymentStatusPill";

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
function moneyCells(figures) {
  const { currency, amount, amountSource, amountBeforeTax, paymentScheme, downPayment, fullPayment, remainingBalance, overpaidBy } =
    figures;
  const money = "text-right text-xs tabular-nums text-foreground";
  return {
    amount: () => (
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
    ),
    "payment-scheme": () => (
      <TableCell className="hidden md:table-cell">
        <span className="block max-w-[12rem] truncate text-xs text-foreground" data-testid="ipas-row-scheme">
          {paymentScheme || "—"}
        </span>
      </TableCell>
    ),
    dp: () => (
      <TableCell className="hidden md:table-cell">
        <span className={`block ${money}`} data-testid="ipas-row-dp">
          {paymentTotal(downPayment, currency)}
        </span>
      </TableCell>
    ),
    fp: () => (
      <TableCell className="hidden md:table-cell">
        <span className={`block ${money}`} data-testid="ipas-row-fp">
          {paymentTotal(fullPayment, currency)}
        </span>
      </TableCell>
    ),
    "remaining-balance": () => (
      <TableCell className="text-right">
        <span className={`block ${money}`} data-testid="ipas-row-remaining">
          {overpaidBy > 0 ? `Overpaid by ${formatAmount(overpaidBy, currency)}` : remainingBalance === null ? "—" : formatAmount(remainingBalance, currency)}
        </span>
      </TableCell>
    ),
  };
}

/**
 * One row of the IPAS list. The whole row opens the IPAS (click, or Enter on
 * the focused row); Entity, Project / SO, Raised and Raised by hide
 * below md so the number, Purpose and Status stay in view. `columns` are the
 * list's shown columns, in order: the cells are drawn in that order. `search`
 * is the list's search text: where it matches, the text is highlighted.
 */
export default function IpasRow({ row, onOpen, columns, search = "" }) {
  const raisedBy = raisedByParts(row);

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
      {cellsInOrder(columns, {
        ipas: () => (
          <TableCell>
            <IdentityText reference={<HighlightText text={row.number} search={search} />}>
              <span title={row.supplier || undefined} className="mt-0.5 block max-w-[16rem] truncate text-xs text-muted-foreground">
                {row.supplier ? <HighlightText text={row.supplier} search={search} /> : "—"}
              </span>
            </IdentityText>
          </TableCell>
        ),
        "odoo-po": () => (
          <TableCell>
            <span className="font-mono text-xs text-foreground">
              <HighlightText text={row.po_number} search={search} />
            </span>
          </TableCell>
        ),
        // A cancelled IPAS has no IPAS Status, so its cell says Cancelled instead.
        status: () => (
          <TableCell>
            {row.state === IPAS_STATE.CANCELLED ? (
              <IpasStateBadge state={row.state} />
            ) : (
              <IpasStatusControl ipas={row} figures={row.figures} />
            )}
          </TableCell>
        ),
        // The Payment status (ADR 0055), read from the same figures as the record's pill and the export.
        "payment-status": () => (
          <TableCell>{row.figures?.paymentStatus ? <IpasPaymentStatusPill figures={row.figures} /> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
        ),
        // How soon the GM should pay the open ask (#1208); blank when nothing is asked.
        priority: () => (
          <TableCell>
            {row.figures?.paymentAsk?.priority ? (
              <span className="whitespace-nowrap text-xs text-foreground" data-testid="ipas-ask-priority">
                {IPAS_ASK_PRIORITY_LABELS[row.figures.paymentAsk.priority] ?? row.figures.paymentAsk.priority}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </TableCell>
        ),
        entity: () => (
          <TableCell className="hidden md:table-cell">
            <span className="whitespace-nowrap text-xs text-muted-foreground">{row.entity || "—"}</span>
          </TableCell>
        ),
        purpose: () => (
          <TableCell>
            <span className="text-xs font-medium text-foreground">{IPAS_PURPOSE_LABELS[row.purpose]}</span>
          </TableCell>
        ),
        costing: () => (
          <TableCell>
            <span className="text-xs text-foreground" data-testid="ipas-row-costing">
              {IPAS_COMPUTATION_STATUS_LABELS[row.computation_status || IPAS_COMPUTATION_STATUS.ENCODING] ?? "—"}
            </span>
          </TableCell>
        ),
        "project-so": () => (
          <TableCell className="hidden md:table-cell">
            {row.sors.length === 0 ? (
              <span className="text-xs text-muted-foreground">—</span>
            ) : (
              <ul className="space-y-0.5" data-testid="ipas-row-sors">
                {row.sors.map((sor) => {
                  const { reference, project } = sorLineParts(sor);
                  // A line leads with the SO number; when the search is the SOR number
                  // of an SOR that has an SO number, the SOR number is shown so the match is visible.
                  const showSorCode = Boolean(sor.salesReference && matchesSorCode(search, sor.sorCode));
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
        ),
        raised: () => (
          <TableCell className="hidden md:table-cell">
            <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{listDate(row.created_at)}</span>
          </TableCell>
        ),
        "raised-by": () => (
          <TableCell className="hidden md:table-cell">
            {raisedBy ? (
              <span className="block max-w-[14rem] truncate text-xs text-foreground" data-testid="ipas-row-raised-by">
                {raisedBy.callSign ? `${raisedBy.callSign} · ${raisedBy.name}` : raisedBy.name}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </TableCell>
        ),
        ...moneyCells(row.figures),
      })}
    </TableRow>
  );
}
