import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FieldBox } from '@/components/ui/FieldBox';
import { SelectField } from '@/components/ui/SelectField';
import { TIME_OPTIONS } from './meetingDraft.js';
import { formatDayLabel, rangeDays } from './activityDays.js';

/**
 * One row per day of an Activity range (#1056), like the leave form's range: each day carries its
 * own start and end times and can be removed or added back. Weekends are kept. `edits` is keyed by
 * date: undefined = the form's start and end, { start, end } = this day's own times, null = removed.
 * A date in `frozen` has already started: its row shows but cannot be changed.
 */
export default function ActivityDayRows({ from, to, edits, onEdit, start, end, frozen = new Set(), timeOptions = TIME_OPTIONS }) {
  const days = rangeDays(from, to, edits);
  if (days.length < 2) return null;
  const kept = days.filter((d) => d.edit !== null);
  const removed = days.filter((d) => d.edit === null);

  return (
    <div className="space-y-1.5 sm:col-span-2" data-testid="activity-day-rows">
      <FieldBox label="Days" className="mb-1.5 block" />
      <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
        {kept.map(({ date, edit }) => {
          const label = formatDayLabel(date);
          const locked = frozen.has(date);
          const dayStart = edit?.start ?? start;
          const dayEnd = edit?.end ?? end;
          return (
            <div key={date} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/60 px-3 py-2">
              <span className="text-xs font-bold text-foreground">{label}</span>
              <div className="flex items-center gap-1.5">
                <SelectField
                  value={dayStart}
                  onChange={(v) => onEdit(date, { start: v, end: dayEnd })}
                  options={timeOptions}
                  disabled={locked}
                  aria-label={`Start for ${label}`}
                  className="w-24"
                />
                <span className="text-xs text-muted-foreground">to</span>
                <SelectField
                  value={dayEnd}
                  onChange={(v) => onEdit(date, { start: dayStart, end: v })}
                  options={timeOptions}
                  disabled={locked}
                  aria-label={`End for ${label}`}
                  className="w-24"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={locked}
                  onClick={() => onEdit(date, null)}
                  className="text-muted-foreground"
                  aria-label={`Remove ${label}`}
                  title={locked ? undefined : 'Remove this day'}
                >
                  <X />
                </Button>
              </div>
            </div>
          );
        })}
        {removed.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-1 pt-0.5">
            <span className="text-[10px] font-semibold text-muted-foreground">Removed:</span>
            {removed.map(({ date }) => (
              <Button
                key={date}
                type="button"
                variant="outline"
                size="xs"
                onClick={() => onEdit(date, undefined)}
                className="text-[10px] font-semibold text-muted-foreground"
                title="Add this day back"
              >
                + {formatDayLabel(date)}
              </Button>
            ))}
          </div>
        )}
        <p className="px-1 pt-0.5 text-[10px] font-semibold text-muted-foreground">
          {kept.length} day{kept.length !== 1 ? 's' : ''}
        </p>
      </div>
    </div>
  );
}
