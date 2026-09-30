import { UserRoundCheck, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Dropdown from '@/components/ui/Dropdown';
import Avatar from '../../../../components/Avatar';
import { LABEL, TYPE_META, useWhoIsOut } from './leaveDisplay';

/**
 * Who is out today and tomorrow, as one header button that opens the lists.
 * It lives in the header so it is there on every view, without a rail of its own.
 */
export default function WhoIsOut({ approvedLeaves }) {
  const out = useWhoIsOut(approvedLeaves);
  const Icon = out.today.length > 0 ? Users : UserRoundCheck;

  return (
    <Dropdown
      usePortal
      placement="bottom-end"
      matchTriggerWidth={false}
      className="w-auto shrink-0"
      trigger={
        <Button type="button" variant="outline" size="lg" aria-haspopup="dialog" className="gap-2">
          <Icon />
          {out.today.length > 0 ? `${out.today.length} out today` : "Everyone's in"}
        </Button>
      }
    >
      <div className="flex w-64 flex-col gap-5 p-3">
        <OutList label="Out today" rows={out.today} empty="Everyone's in." />
        <OutList label="Out tomorrow" rows={out.tomorrow} empty="No one." />
      </div>
    </Dropdown>
  );
}

function OutList({ label, rows, empty }) {
  return (
    <div>
      <p className={`${LABEL} mb-2.5`}>{label}</p>
      {rows.length === 0 ? (
        <p className="text-xs font-medium text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {rows.map((r) => (
            <li key={`${r.employee_id}_${r.type}`} className="flex items-center gap-2.5">
              <Avatar name={r.employee?.name} src={r.employee?.avatar_path} size="xs" />
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">{r.employee?.name}</span>
              <span className={`size-2 shrink-0 rounded-full ${TYPE_META[r.type].dot}`} title={TYPE_META[r.type].label} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
