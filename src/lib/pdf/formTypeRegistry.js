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
};

/** Resolves a record's `type` to its registry entry, or fails loudly rather than silently defaulting to a leave form. */
export function getFormType(recordType) {
  const entry = FORM_TYPES[recordType];
  if (!entry) throw new Error(`Unknown form record type: "${recordType}"`);
  return entry;
}
