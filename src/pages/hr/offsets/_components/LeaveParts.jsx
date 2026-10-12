import StatusBadge from '../../../../components/StatusBadge';
import { statusOf } from './leaveDisplay';

/** A request's state as the shared StatusBadge (Pending / Overdue / Approved · Offset / …). */
export function StatusPill({ record }) {
  const s = statusOf(record);
  return <StatusBadge theme={s.theme} label={s.label} />;
}
