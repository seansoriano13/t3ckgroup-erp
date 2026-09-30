import StatusBadge from '../../../../components/StatusBadge';
import { statusOf } from './leaveDisplay';

/** A request's state as the shared StatusBadge (Pending / Overdue / Approved · Offset / …). */
export function StatusPill({ record }) {
  const s = statusOf(record);
  return <StatusBadge theme={s.theme} label={s.label} />;
}

export function EmptyState({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
      {Icon && <Icon size={32} className="text-muted-foreground/60" />}
      <p className="text-base font-black text-foreground">{title}</p>
      {children && <p className="max-w-sm text-sm font-medium text-muted-foreground">{children}</p>}
    </div>
  );
}
