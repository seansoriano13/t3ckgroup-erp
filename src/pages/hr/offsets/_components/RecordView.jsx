import { useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Avatar from '../../../../components/Avatar';
import { AttachmentList } from '../../../../components/ui/Attachments';
import { StatusPill, TypeChip } from './LeaveParts';
import { LABEL, TYPE_META, ago, balanceFor, fmtDay, hoursOf, recordKey, statusOf, windowOf } from './leaveDisplay';

const LONG_DATE = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };

/**
 * One request as its own page: what was asked, why, what happened so far, and
 * the Decision card beside it. `list` is the list it was opened from, so the
 * arrows step through the queue without going back.
 */
export default function RecordView({ record: r, list, onStep, onBack, handleAction, handleUndo, setPreviewToken, availableHoursFor }) {
  const idx = list.findIndex((x) => recordKey(x) === recordKey(r));
  const pending = r.status === 'PENDING';
  const h = hoursOf(r);
  const decided = statusOf(r);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Button type="button" variant="ghost" onClick={onBack} className="h-10 gap-2 px-3 font-semibold text-muted-foreground hover:text-foreground">
          <ArrowLeft /> Back to {pending ? 'Pending' : 'Request History'}
        </Button>
        {idx >= 0 && list.length > 1 && (
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs tabular-nums text-muted-foreground">{idx + 1} of {list.length}</span>
            <div className="flex gap-1.5">
              <Button type="button" variant="outline" size="icon" disabled={idx <= 0} onClick={() => onStep(list[idx - 1])} aria-label="Previous request"><ChevronLeft /></Button>
              <Button type="button" variant="outline" size="icon" disabled={idx >= list.length - 1} onClick={() => onStep(list[idx + 1])} aria-label="Next request"><ChevronRight /></Button>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-5">
        <Avatar name={r.employee?.name} src={r.employee?.avatar_path} size="xl" />
        <div className="min-w-0">
          <h2 className="text-3xl font-black tracking-tight text-foreground">{r.employee?.name}</h2>
          <p className="mt-1 text-sm font-medium text-muted-foreground">{[r.employee?.department, r.company?.name].filter(Boolean).join(' · ')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <TypeChip type={r.type} />
            <StatusPill record={r} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-8">
          <div className="divide-y divide-border rounded-2xl border border-border bg-card">
            <section className="p-7">
              <h3 className="mb-6 text-base font-black text-foreground">Request</h3>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                <Field label="From">{fmtDay(r.startDate || r.date, LONG_DATE)}</Field>
                <Field label="To">{fmtDay(r.endDate || r.date, LONG_DATE)}</Field>
                <Field label="Hours"><span className="font-mono">{h.changed ? `${h.granted} granted of ${h.requested}` : h.requested}</span></Field>
                <Field label="Time window">{windowOf(r)}</Field>
                <Field label="Category">{r.category?.label}</Field>
                <Field label="Days">{r.dayCount || 1}</Field>
              </div>
            </section>
            <section className="p-7">
              <h3 className="mb-4 text-base font-black text-foreground">Reason</h3>
              <p className="max-w-[65ch] whitespace-pre-line rounded-xl bg-muted/50 px-5 py-4 text-sm font-medium leading-relaxed text-foreground">
                {r.reason || <span className="text-muted-foreground">No reason given.</span>}
              </p>
            </section>
            {r.attachments?.length > 0 && (
              <section className="p-7">
                <h3 className="mb-4 text-base font-black text-foreground">Attachments</h3>
                <AttachmentList attachments={r.attachments} />
              </section>
            )}
          </div>

          <section>
            <h3 className="mb-5 text-base font-black text-foreground">Activity</h3>
            <ol className="ml-2 flex flex-col gap-5 border-l border-border pl-6">
              <ActivityItem dot="bg-mauve-8" when={r.created_at}>
                <b>{r.employee?.name}</b> applied for {h.requested} hrs of {TYPE_META[r.type].label}
              </ActivityItem>
              {r.hr_override ? (
                <ActivityItem dot="bg-mauve-8">HR override: department-head approval skipped</ActivityItem>
              ) : r.head_status === 'APPROVED' ? (
                <ActivityItem dot="bg-green-9">Department head approved</ActivityItem>
              ) : null}
              {pending ? (
                <ActivityItem dot="bg-amber-9">Waiting on HR decision</ActivityItem>
              ) : (
                <ActivityItem dot={decided.dot} when={r.updated_at}>
                  HR decision: <b>{decided.label}</b>{h.changed ? ` at ${h.granted} hrs` : ''}
                </ActivityItem>
              )}
              {r.printed_at && <ActivityItem dot="bg-mauve-8" when={r.printed_at}>Printed on its TG form</ActivityItem>}
            </ol>
          </section>
        </div>

        {/* Keyed so the Offset/Paid choice resets when stepping to another request. */}
        <DecisionCard
          key={recordKey(r)}
          r={r}
          handleAction={handleAction}
          handleUndo={handleUndo}
          setPreviewToken={setPreviewToken}
          available={pending ? availableHoursFor(r) : null}
        />
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <p className={`${LABEL} mb-2`}>{label}</p>
      <div className="flex min-h-11 items-center rounded-xl bg-muted/50 px-4 py-2.5 text-sm font-semibold text-foreground">
        {children ?? <span className="text-muted-foreground">—</span>}
      </div>
    </div>
  );
}

function ActivityItem({ dot, when, children }) {
  return (
    <li className="relative text-sm font-medium text-foreground">
      <span className={`absolute -left-[29px] top-1.5 size-2.5 rounded-full ring-4 ring-background ${dot}`} />
      {children}
      {when && <span className="ml-2 font-mono text-xs text-muted-foreground">{ago(when)}</span>}
    </li>
  );
}

/**
 * The only place a decision is made. Overtime's Offset-or-Paid split is a
 * choice here rather than two approve buttons; every approve still goes
 * through the page's own flow (hours modal or confirm) before saving.
 */
function DecisionCard({ r, handleAction, handleUndo, setPreviewToken, available }) {
  const pending = r.status === 'PENDING';
  const [otAs, setOtAs] = useState('offset');
  const h = hoursOf(r);

  if (!pending) {
    return (
      <aside className="flex flex-col gap-6 rounded-2xl border border-border bg-card p-6 lg:sticky lg:top-6">
        <h3 className="text-base font-black text-foreground">Decided</h3>
        <dl className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-y-3 text-sm">
          <dt className="font-medium text-muted-foreground">Outcome</dt>
          <dd><StatusPill record={r} /></dd>
          <dt className="font-medium text-muted-foreground">Hours</dt>
          <dd className="font-mono font-semibold text-foreground">{h.granted}{h.changed ? ` of ${h.requested}` : ''}</dd>
          <dt className="font-medium text-muted-foreground">Decided</dt>
          <dd className="font-semibold text-foreground">{r.updated_at ? fmtDay(r.updated_at, { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</dd>
        </dl>
        <div className="flex flex-col gap-2.5">
          {r.verification_token && (
            <Button type="button" variant="outline" onClick={() => setPreviewToken(r.verification_token)} className="h-11 w-full text-sm font-bold">
              Preview record
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => handleUndo(r)} className="h-11 w-full text-sm font-bold text-destructive hover:text-destructive">
            Undo decision
          </Button>
        </div>
        <p className="text-xs font-medium leading-relaxed text-muted-foreground">
          Undo returns the request to Pending{r.type === 'UNDERTIME' ? '' : ' and restores the balance'}.
        </p>
      </aside>
    );
  }

  const approve = () => handleAction(r, r.type === 'OVERTIME' && otAs === 'paid' ? 'approve_paid' : 'approve');

  return (
    <aside className="flex flex-col gap-6 rounded-2xl border border-border bg-card p-6 lg:sticky lg:top-6">
      <h3 className="text-base font-black text-foreground">Decision</h3>
      <Impact r={r} available={available} />

      {r.type === 'OVERTIME' && (
        <div className="flex flex-col gap-2" role="radiogroup" aria-label="Approve overtime as">
          <p className={LABEL}>Approve as</p>
          {[
            ['offset', 'Offset hours', `Adds ${h.requested} hrs to the Offset balance`],
            ['paid', 'Paid overtime', 'Goes to payroll; no balance change'],
          ].map(([value, title, detail]) => (
            <Button
              key={value}
              type="button"
              variant="outline"
              role="radio"
              aria-checked={otAs === value}
              onClick={() => setOtAs(value)}
              className={`h-auto justify-start gap-3 whitespace-normal rounded-xl px-4 py-3 text-left ${otAs === value ? 'border-mauve-12 bg-muted' : ''}`}
            >
              <span className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${otAs === value ? 'border-mauve-12 bg-mauve-12' : 'border-mauve-8'}`}>
                {otAs === value && <span className="size-1.5 rounded-full bg-mauve-1" />}
              </span>
              <span>
                <span className="block text-sm font-bold text-foreground">{title}</span>
                <span className="block text-xs font-medium text-muted-foreground">{detail}</span>
              </span>
            </Button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        <Button type="button" onClick={approve} className="h-11 w-full text-sm font-bold">
          <Check />
          {r.type === 'OVERTIME' ? `Approve as ${otAs === 'offset' ? 'Offset' : 'Paid'}` : `Approve ${h.requested} hrs`}
        </Button>
        <Button type="button" variant="outline" onClick={() => handleAction(r, 'reject')} className="h-11 w-full text-sm font-bold text-destructive hover:text-destructive">
          <X /> Reject
        </Button>
      </div>
      <p className="text-xs font-medium leading-relaxed text-muted-foreground">You confirm before anything is saved.</p>
    </aside>
  );
}

/** Balance, this request, what's left once every pending request is counted. */
function Impact({ r, available }) {
  if (r.type === 'UNDERTIME') {
    return <p className="text-sm font-medium leading-relaxed text-muted-foreground">Counts toward this month's undertime. It is not taken from any balance.</p>;
  }
  const bal = balanceFor(r);
  if (bal == null || available == null) return null;
  const others = Math.max(0, bal - available - r.hours);
  const scale = Math.max(bal, bal - available, 1);
  const pct = (n) => `${Math.max(0, Math.min(100, (n / scale) * 100))}%`;
  const short = available < 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-3">
        <Figure label="Balance" value={bal} />
        <Figure label="Requested" value={r.hours} />
        <Figure label="Left after" value={available} warn={short} />
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        {others > 0 && <span className="h-full bg-mauve-7" style={{ width: pct(others) }} />}
        <span className={`h-full ${short ? 'bg-red-9' : TYPE_META[r.type].solid}`} style={{ width: pct(r.hours) }} />
      </div>
      {(others > 0 || short) && (
        <p className={`flex items-start gap-1.5 text-xs font-semibold ${short ? 'text-red-11' : 'text-muted-foreground'}`}>
          {short && <AlertTriangle size={13} className="mt-px shrink-0" />}
          {short
            ? `Short by ${Math.abs(available)} hrs once every pending request is counted.`
            : `${others} hrs are already held by other pending requests.`}
        </p>
      )}
    </div>
  );
}

function Figure({ label, value, warn }) {
  return (
    <div>
      <p className={LABEL}>{label}</p>
      <p className={`mt-1 font-mono text-xl font-semibold tabular-nums ${warn ? 'text-red-11' : 'text-foreground'}`}>
        {value}<span className="ml-1 text-xs text-muted-foreground">hrs</span>
      </p>
    </div>
  );
}
