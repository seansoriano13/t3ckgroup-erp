import StatusBadge from '../../../../components/StatusBadge';
import { STATUS_THEME } from '../../../../constants/statusTheme';
import { statusOf } from './leaveDisplay';

/** A request's state as the shared StatusBadge (Pending / Overdue / Approved · Offset / …). */
export function StatusPill({ record }) {
  const s = statusOf(record);
  return (
    <span className="inline-flex items-center gap-1.5">
      <StatusBadge theme={s.theme} label={s.label} />
      {record.recorded_by_hr && <StatusBadge theme={STATUS_THEME.MAUVE} label="Recorded by HR" />}
    </span>
  );
}
