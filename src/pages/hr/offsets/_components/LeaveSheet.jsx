import { useState } from 'react';
import { AlertTriangle, CalendarDays, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Dot from '@/components/ui/Dot';
import SlideOver, { SlideOverBody, SlideOverFooter } from '@/components/ui/SlideOver';
import { DetailRow, DetailSection, PersonChip } from '@/components/ui/DetailParts';
import { AttachmentList } from '../../../../components/ui/Attachments';
import { APPROVE_CLASS } from '../../../approvals/_components/approvalUi';
import { StatusPill } from './LeaveParts';
import { LABEL, TYPE_META, ago, balanceFor, fmtDay, fmtRange, hoursOf, recordKey, statusOf, windowOf } from './leaveDisplay';

const LONG_DATE = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };

// SlideOver shows `ref` as-is in mono; the type reads as a code there.
const identity = (request) => ({
  ref: TYPE_META[request.type].label.toUpperCase(),
  title: request.employee?.name,
  badge: <StatusPill record={request} />,
  subtitle: `${hoursOf(request).requested} hrs · ${fmtRange(request, true)}`,
});

/**
 * One leave, Offset, overtime or undertime request on the shared slide-over
 * (the same one Leave Approvals uses): what was asked, why, what happened so
 * far, and the decision pinned to the foot. `index` / `total` position it in
 * the list it was opened from so the arrows step through that list.
 *
 * `actions` is `{ decide(request, 'approve' | 'approve_paid' | 'reject'),
 * undo(request), preview(token) }`; every approve still goes through the
 * page's own hours modal or confirm before anything is saved.
 */
export default function LeaveSheet({ record, crumb, index, total, onStep, onClose, actions, availableHoursFor }) {
  // Overtime's Offset-or-Paid pick lives here, not in the footer: the sheet
  // slides away while the hours modal is open, which unmounts its content, and
  // a cancelled modal must come back to the same choice.
  const [pick, setPick] = useState({ key: null, as: 'offset' });

  return (
    <SlideOver
      record={record}
      icon={CalendarDays}
      crumb={crumb}
      identity={identity}
      index={index}
      total={total}
      onStep={onStep}
      onClose={onClose}
    >
      {(request) => {
        const key = recordKey(request);
        return (
          <LeaveSheetContent
            key={key}
            request={request}
            actions={actions}
            overtimeAs={pick.key === key ? pick.as : 'offset'}
            onOvertimeAs={(as) => setPick({ key, as })}
            availableHours={request.status === 'PENDING' ? availableHoursFor(request) : null}
          />
        );
      }}
    </SlideOver>
  );
}

function LeaveSheetContent({ request, actions, overtimeAs, onOvertimeAs, availableHours }) {
  const pending = request.status === 'PENDING';
  const hours = hoursOf(request);
  const decision = statusOf(request);

  return (
    <>
      <SlideOverBody>
        <PersonChip
          size="lg"
          person={{ id: request.employee_id, name: request.employee?.name, avatarPath: request.employee?.avatar_path }}
          detail={[request.employee?.department, request.company?.name].filter(Boolean).join(' · ')}
        />

        <DetailSection title="Request">
          <dl className="divide-y divide-border/70">
            <DetailRow label="Type">{TYPE_META[request.type].label}</DetailRow>
            <DetailRow label="From">{fmtDay(request.startDate || request.date, LONG_DATE)}</DetailRow>
            <DetailRow label="To">{fmtDay(request.endDate || request.date, LONG_DATE)}</DetailRow>
            <DetailRow label="Hours"><span className="font-mono">{hours.requested}</span></DetailRow>
            <DetailRow label="Time window">{windowOf(request)}</DetailRow>
            <DetailRow label="Category">{request.category?.label}</DetailRow>
            <DetailRow label="Days">{request.dayCount || 1}</DetailRow>
          </dl>
        </DetailSection>

        {!pending && (
          <DetailSection title="Decision">
            <dl className="divide-y divide-border/70">
              <DetailRow label="Outcome"><StatusPill record={request} /></DetailRow>
              <DetailRow label="Hours">
                <span className="font-mono">{hours.granted}{hours.changed ? ` of ${hours.requested}` : ''}</span>
              </DetailRow>
              <DetailRow label="Decided">
                {request.updated_at ? fmtDay(request.updated_at, { month: 'short', day: 'numeric', year: 'numeric' }) : null}
              </DetailRow>
            </dl>
          </DetailSection>
        )}

        <DetailSection title="Reason">
          <p className="whitespace-pre-line rounded-xl bg-muted/50 px-4 py-3 text-[13px] font-medium leading-relaxed text-foreground">
            {request.reason || <span className="text-muted-foreground">No reason given.</span>}
          </p>
        </DetailSection>

        {request.attachments?.length > 0 && (
          <DetailSection title="Attachments">
            <AttachmentList attachments={request.attachments} />
          </DetailSection>
        )}

        {pending && <BalanceImpact request={request} available={availableHours} />}

        <DetailSection title="Activity">
          <ol className="ml-2 flex flex-col gap-4 border-l border-border pl-5">
            <ActivityItem dot="bg-mauve-8" when={request.created_at}>
              <b>{request.employee?.name}</b> applied for {hours.requested} hrs of {TYPE_META[request.type].label}
            </ActivityItem>
            {request.hr_override ? (
              <ActivityItem dot="bg-mauve-8">HR override: department-head approval skipped</ActivityItem>
            ) : request.head_status === 'APPROVED' ? (
              <ActivityItem dot="bg-green-9">Department head approved</ActivityItem>
            ) : null}
            {pending ? (
              <ActivityItem dot="bg-amber-9">Waiting on HR decision</ActivityItem>
            ) : (
              <ActivityItem dot={decision.dot} when={request.updated_at}>
                HR decision: <b>{decision.label}</b>{hours.changed ? ` at ${hours.granted} hrs` : ''}
              </ActivityItem>
            )}
            {request.printed_at && <ActivityItem dot="bg-mauve-8" when={request.printed_at}>Printed on its TG form</ActivityItem>}
          </ol>
        </DetailSection>
      </SlideOverBody>

      {pending ? (
        <PendingFooter request={request} decide={actions.decide} overtimeAs={overtimeAs} onOvertimeAs={onOvertimeAs} />
      ) : (
        <SlideOverFooter>
          <div className="flex gap-2">
            {request.verification_token && (
              <Button type="button" variant="outline" className="flex-1" onClick={() => actions.preview(request.verification_token)}>
                Preview record
              </Button>
            )}
            <Button type="button" variant="destructive" className="flex-1" onClick={() => actions.undo(request)}>
              Undo decision
            </Button>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Undo returns the request to Pending{request.type === 'UNDERTIME' ? '' : ' and restores the balance'}.
          </p>
        </SlideOverFooter>
      )}
    </>
  );
}

function ActivityItem({ dot, when, children }) {
  return (
    <li className="relative text-[13px] font-medium text-foreground">
      <Dot size="size-2" color={dot} className="absolute -left-6.25 top-1.5 ring-4 ring-card" />
      {children}
      {when && <span className="ml-2 font-mono text-xs text-muted-foreground">{ago(when)}</span>}
    </li>
  );
}

/**
 * The only place a decision is made. Overtime's Offset-or-Paid split is a
 * choice here rather than two approve buttons. There is no radio Primitive, so
 * the choice is `role="radio"` on the Button Primitive.
 */
function PendingFooter({ request, decide, overtimeAs, onOvertimeAs }) {
  const hours = hoursOf(request);
  const approve = () => decide(request, request.type === 'OVERTIME' && overtimeAs === 'paid' ? 'approve_paid' : 'approve');

  return (
    <SlideOverFooter>
      {request.type === 'OVERTIME' && (
        <div
          className="flex flex-col gap-2"
          role="radiogroup"
          aria-label="Approve overtime as"
          onKeyDown={(e) => {
            const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
            if (!step) return;
            e.preventDefault();
            const radios = [...e.currentTarget.querySelectorAll('[role="radio"]')];
            const next = radios[(radios.indexOf(document.activeElement) + step + radios.length) % radios.length];
            next?.focus();
            next?.click();
          }}
        >
          <p className={LABEL}>Approve as</p>
          {[
            ['offset', 'Offset hours', `Adds ${hours.requested} hrs to the Offset balance`],
            ['paid', 'Paid overtime', 'Goes to payroll; no balance change'],
          ].map(([value, title, detail]) => (
            <Button
              key={value}
              type="button"
              variant="outline"
              role="radio"
              aria-checked={overtimeAs === value}
              tabIndex={overtimeAs === value ? 0 : -1}
              onClick={() => onOvertimeAs(value)}
              className={`h-auto justify-start gap-3 whitespace-normal rounded-xl px-4 py-3 text-left ${overtimeAs === value ? 'border-mauve-12 bg-muted' : ''}`}
            >
              <span className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${overtimeAs === value ? 'border-mauve-12 bg-mauve-12' : 'border-mauve-8'}`}>
                {overtimeAs === value && <Dot size="size-1.5" color="bg-mauve-1" />}
              </span>
              <span>
                <span className="block text-sm font-bold text-foreground">{title}</span>
                <span className="block text-xs font-medium text-muted-foreground">{detail}</span>
              </span>
            </Button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="destructive" className="flex-1" onClick={() => decide(request, 'reject')}>
          Decline
        </Button>
        <Button type="button" className={`flex-1 ${APPROVE_CLASS}`} onClick={approve}>
          <Check />
          {request.type === 'OVERTIME' ? `Approve as ${overtimeAs === 'offset' ? 'Offset' : 'Paid'}` : `Approve ${hours.requested} hrs`}
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">You confirm before anything is saved.</p>
    </SlideOverFooter>
  );
}

/** Balance, this request, what's left once every pending request is counted. */
function BalanceImpact({ request, available }) {
  if (request.type === 'UNDERTIME') {
    return (
      <DetailSection title="Balance impact">
        <p className="text-[13px] leading-relaxed text-muted-foreground">Counts toward this month’s undertime. It is not taken from any balance.</p>
      </DetailSection>
    );
  }
  const balance = balanceFor(request);
  if (balance == null || available == null) return null;
  const heldByOthers = Math.max(0, balance - available - request.hours);
  const barTotal = Math.max(balance, balance - available, 1);
  const barWidth = (hours) => `${Math.max(0, Math.min(100, (hours / barTotal) * 100))}%`;
  const short = available < 0;

  return (
    <DetailSection title="Balance impact">
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-3 gap-3">
          <Figure label="Balance" value={balance} />
          <Figure label="Requested" value={request.hours} />
          <Figure label="Left after" value={available} warn={short} />
        </div>
        <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
          {heldByOthers > 0 && <span className="h-full bg-mauve-7" style={{ width: barWidth(heldByOthers) }} />}
          <span className={`h-full ${short ? 'bg-red-9' : TYPE_META[request.type].solid}`} style={{ width: barWidth(request.hours) }} />
        </div>
        {(heldByOthers > 0 || short) && (
          <p className={`flex items-start gap-1.5 text-xs font-semibold ${short ? 'text-red-11' : 'text-muted-foreground'}`}>
            {short && <AlertTriangle size={13} className="mt-px shrink-0" />}
            {short
              ? `Short by ${Math.abs(available)} hrs once every pending request is counted.`
              : `${heldByOthers} hrs are already held by other pending requests.`}
          </p>
        )}
      </div>
    </DetailSection>
  );
}

function Figure({ label, value, warn }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 font-mono text-xl font-semibold tabular-nums ${warn ? 'text-red-11' : 'text-foreground'}`}>
        {value}<span className="ml-1 text-xs text-muted-foreground">hrs</span>
      </p>
    </div>
  );
}
