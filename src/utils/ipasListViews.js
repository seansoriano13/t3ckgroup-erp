/**
 * The IPAS list's built-in views (spec #595, ticket #599). Pure: a view narrows the rows by the
 * figures each row carries (utils/ipasFigures.js) and by the signed-in employee.
 */

import { IPAS_PAYMENT_STATUS, IPAS_STATE } from "../constants/ipas";

/** The list's built-in views (a view narrows the rows; null is no view). */
export const IPAS_VIEW = Object.freeze({
  UNPAID: "unpaid",
  ON_HOLD: "on_hold",
  ONGOING: "ongoing",
  MINE: "mine",
  PAYMENT_FORECAST: "payment_forecast",
});

export const IPAS_VIEW_LABELS = {
  [IPAS_VIEW.UNPAID]: "Unpaid",
  [IPAS_VIEW.ON_HOLD]: "On-Hold",
  [IPAS_VIEW.ONGOING]: "Ongoing",
  [IPAS_VIEW.MINE]: "Raised by me",
  [IPAS_VIEW.PAYMENT_FORECAST]: "Payment Forecast",
};

/**
 * Whether a row belongs to a view. Unpaid is the open IPAS with no full payment
 * recorded; On-Hold is the On-Hold flag; Ongoing is an open IPAS with some money
 * paid and no full payment; Payment Forecast is every IPAS whose Payment status is For payment (#1190);
 * Raised by me is the IPAS the signed-in employee raised.
 */
export function inIpasView(row, view, userId) {
  switch (view) {
    case IPAS_VIEW.UNPAID:
      return row.state === IPAS_STATE.OPEN && !row.figures?.hasFullPayment;
    case IPAS_VIEW.ON_HOLD:
      return row.figures?.onHold === true;
    case IPAS_VIEW.ONGOING:
      return row.state === IPAS_STATE.OPEN && Number(row.figures?.paid) > 0 && !row.figures?.hasFullPayment;
    case IPAS_VIEW.MINE:
      return Boolean(userId) && row.created_by === userId;
    case IPAS_VIEW.PAYMENT_FORECAST:
      return row.figures?.paymentStatus === IPAS_PAYMENT_STATUS.FOR_PAYMENT;
    default:
      return true;
  }
}
