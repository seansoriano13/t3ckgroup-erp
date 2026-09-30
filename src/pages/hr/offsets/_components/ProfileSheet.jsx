import { CalendarCheck, Clock, Scale, TimerOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Dot from '@/components/ui/Dot';
import SlideOver, { SlideOverBody } from '@/components/ui/SlideOver';
import { DetailSection } from '@/components/ui/DetailParts';
import { StatusPill } from './LeaveParts';
import { TYPE_META, fmtRange, hoursOf, num, recordKey } from './leaveDisplay';

const identity = (p) => ({
  ref: 'TIME OFF',
  title: p.name,
  subtitle: [p.department, p.company?.name].filter(Boolean).join(' · ') || 'No department',
});

/**
 * One employee's Time Off profile on the shared slide-over: their balances and
 * what is waiting on HR or was decided this period. `held(type)` is the hours
 * their pending requests already commit; `onReview` opens one of those.
 */
export default function ProfileSheet({ person, held, pending, decided, onClose, onReview }) {
  return (
    <SlideOver record={person} icon={Scale} crumb="Employee Balances" identity={identity} onClose={onClose}>
      {(p) => (
        <SlideOverBody>
          <div className="grid grid-cols-3 gap-3">
            <BalanceBlock icon={Clock} label="Offset" hours={p.offset_hours_balance} held={held('OFFSET')} />
            <BalanceBlock icon={CalendarCheck} label="SIL" hours={p.sil_hours_balance} held={held('SIL')} />
            <BalanceBlock icon={TimerOff} label="Undertime" hours={p.undertime_this_month} note="this month" />
          </div>

          <ProfileList title="Waiting on HR" rows={pending} empty="Nothing pending." onReview={(r) => onReview(r, pending)} />
          <ProfileList title="Decided this period" rows={decided} empty="No decisions this period." />
        </SlideOverBody>
      )}
    </SlideOver>
  );
}

function BalanceBlock({ icon: Icon, label, hours, held = 0, note }) {
  const left = Math.round((num(hours) - held) * 100) / 100;
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground"><Icon size={14} /> {label}</p>
      <p className="mt-2 text-2xl font-black tracking-tight text-foreground">
        {hours}<span className="ml-1 text-xs font-bold text-muted-foreground">hrs</span>
      </p>
      <p className={`mt-1 text-xs font-medium ${left < 0 ? 'text-red-11' : 'text-muted-foreground'}`}>
        {note || (held > 0 ? `${held} pending · ${left} left` : 'available')}
      </p>
    </div>
  );
}

function ProfileList({ title, rows, empty, onReview }) {
  return (
    <DetailSection title={title}>
      {rows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {rows.map((r) => (
            <li key={recordKey(r)} className="flex items-center gap-3 px-4 py-3 text-[13px]">
              <Dot size="size-2" color={TYPE_META[r.type].dot} />
              <span className="w-20 shrink-0 font-bold text-foreground">{TYPE_META[r.type].label}</span>
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">{fmtRange(r, true)}</span>
              <span className="font-mono tabular-nums text-muted-foreground">{hoursOf(r).granted}h</span>
              {onReview
                ? <Button type="button" variant="outline" size="sm" onClick={() => onReview(r)}>Review</Button>
                : <StatusPill record={r} />}
            </li>
          ))}
        </ul>
      )}
    </DetailSection>
  );
}
