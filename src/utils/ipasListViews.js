/**
 * The IPAS list's built-in views (spec #595, ticket #599). Pure: a view narrows the rows by the
 * figures each row carries (utils/ipasFigures.js) and by the signed-in employee.
 */

import { IPAS_STATE, IPAS_STATUS } from "../constants/ipas";

/** The list's built-in views (a view narrows the rows; null is no view). */
export const IPAS_VIEW = Object.freeze({
  UNPAID: "unpaid",
  ON_HOLD: "on_hold",
  ONGOING: "ongoing",
  MINE: "mine",
});

export const IPAS_VIEW_LABELS = {
  [IPAS_VIEW.UNPAID]: "Unpaid",
  [IPAS_VIEW.ON_HOLD]: "On-Hold",
  [IPAS_VIEW.ONGOING]: "Ongoing",
  [IPAS_VIEW.MINE]: "Raised by me",
};

/**
 * Whether a row belongs to a view. Unpaid is the open IPAS that are not yet
 * Paid (Done is a filed one, so it is never open); On-Hold and Ongoing are that
 * IPAS Status; Raised by me is the IPAS the signed-in employee raised.
 */
export function inIpasView(row, view, userId) {
  switch (view) {
    case IPAS_VIEW.UNPAID:
      return row.state === IPAS_STATE.OPEN && row.figures?.status !== IPAS_STATUS.PAID && row.figures?.status !== IPAS_STATUS.DONE;
    case IPAS_VIEW.ON_HOLD:
      return row.figures?.status === IPAS_STATUS.ON_HOLD;
    case IPAS_VIEW.ONGOING:
      return row.figures?.status === IPAS_STATUS.ONGOING;
    case IPAS_VIEW.MINE:
      return Boolean(userId) && row.created_by === userId;
    default:
      return true;
  }
}
