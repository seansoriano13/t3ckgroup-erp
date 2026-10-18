/**
 * Issue #153: the one place a record's `type` is resolved to everything the
 * printing pipeline needs to know about it — which view-model builder maps
 * it, and which service call stamps it printed. Replaces the four
 * hard-coded switch points that used to be threaded through separately
 * (formViewModel's record-number prefix, htmlPrinter's LV-substring form
 * label, htmlPrinter's view-model dispatch, and the Document Center's
 * print-stamp dispatch) — a fifth record type now means one new entry here,
 * not four call sites to find.
 */

import { buildTG11ViewModel, buildTG12ViewModel, buildTG13ViewModel } from './formViewModel';
import { buildCanvassViewModel } from './canvassViewModel';
import { buildCostingMatrixViewModel } from './costingMatrixViewModel';
import { buildIpasViewModel } from './ipasViewModel';
import { buildPackingListViewModel } from './packingListViewModel';
import { buildTransmittalViewModel } from './transmittalViewModel';
import { buildTsrViewModel } from './tsrViewModel';
import { offsetService } from '../../services/offsetService';
import { silService } from '../../services/silService';

const FORM_TYPES = {
  SIL: {
    buildViewModel: buildTG11ViewModel,
    markPrinted: (record, hrId) => silService.markSilLeavesPrinted({ id: record.id, groupId: record.leave_group_id, hrId }),
  },
  OFFSET: {
    buildViewModel: buildTG11ViewModel,
    markPrinted: (record, hrId) => offsetService.markOffsetLeavesPrinted({ id: record.id, groupId: record.leave_group_id, hrId }),
  },
  OVERTIME: {
    buildViewModel: buildTG12ViewModel,
    markPrinted: (record, hrId) => offsetService.markOvertimeRequestsPrinted({ id: record.id, hrId }),
  },
  UNDERTIME: {
    buildViewModel: buildTG13ViewModel,
    markPrinted: (record, hrId) => offsetService.markUndertimeRequestsPrinted({ id: record.id, hrId }),
  },
  // Issue #250: the IPAS prints on two A4 pages through its own composer
  // (ipasDocument.js), not the paired Letter half-sheets, so its builder takes
  // `ipasService.get`'s result and a `{ filingCopy }` option. Printing an IPAS
  // stamps nothing: there is no "printed" state to move, so markPrinted is a
  // no-op that keeps the registry's contract (every type has one).
  IPAS: {
    buildViewModel: buildIpasViewModel,
    markPrinted: async () => {},
  },
  // Issue #260: the Packing List prints as one A4 sheet (packingListDocument.js)
  // from `packingListService.get`'s shape. Printing stamps nothing, so markPrinted
  // is a no-op, as for the IPAS.
  PACKING_LIST: {
    buildViewModel: buildPackingListViewModel,
    markPrinted: async () => {},
  },
  // Issue #258: the Transmittal prints as TG03 (transmittalDocument.js) from
  // `transmittalService.get`'s shape. Printing stamps nothing, so markPrinted is a no-op.
  TRANSMITTAL: {
    buildViewModel: buildTransmittalViewModel,
    markPrinted: async () => {},
  },
  // Issue #274: the Costing Matrix prints on landscape A4 (costingMatrixDocument.js) from
  // `costingMatrixService.get`'s shape, with the money sheet for the Closed Book tier only. Printing
  // stamps nothing, so markPrinted is a no-op.
  costing_matrix: {
    buildViewModel: buildCostingMatrixViewModel,
    markPrinted: async () => {},
  },
  // Issue #282: the Canvass prints on portrait A4 (canvassDocument.js) from `canvassService.get`'s shape,
  // for a reader with the money tier only. Printing stamps nothing, so markPrinted is a no-op.
  canvass: {
    buildViewModel: buildCanvassViewModel,
    markPrinted: async () => {},
  },
  // Issue #259: the TSR prints as one A4 sheet (tsrDocument.js) from a TSR record.
  // Printing stamps nothing, so markPrinted is a no-op.
  TSR: {
    buildViewModel: buildTsrViewModel,
    markPrinted: async () => {},
  },
};

/** Resolves a record's `type` to its registry entry, or fails loudly rather than silently defaulting to a leave form. */
export function getFormType(recordType) {
  const entry = FORM_TYPES[recordType];
  if (!entry) throw new Error(`Unknown form record type: "${recordType}"`);
  return entry;
}
