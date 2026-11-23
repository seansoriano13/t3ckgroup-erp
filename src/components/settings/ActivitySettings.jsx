import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarClock } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SelectField } from "@/components/ui/SelectField";
import PeoplePicker from "@/components/ui/PeoplePicker";
import { SELECTOR_TYPES } from "@/utils/resolvePeople";
import { FieldBox } from "@/components/ui/FieldBox";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import { ACTIVITY_COLORS, ACTIVITY_COLOR_KEYS } from "@/constants/activityColors";
import { ACTIVITY_SETTINGS_KEY, useActivitySettings } from "@/hooks/useActivitySettings";
import { activitySettingsService } from "@/services/activitySettingsService";
import { ACTIVITY_TYPE_KEYS, MEETING_TYPE_KEYS, fitDefaults, timeOptions, timesOfDay } from "@/utils/activitySettings";

const WHO_OPTIONS = [
  { value: "EVERYONE", label: "Everyone" },
  { value: "HEADS", label: "Department heads only" },
];
const STEP_OPTIONS = [15, 30, 60].map((m) => ({ value: String(m), label: `${m} minutes` }));
const REMINDER_OPTIONS = [5, 10, 15, 30, 45, 60, 120, 240, 1440].map((m) => ({
  value: String(m),
  label: m >= 60 ? `${m / 60} hour${m === 60 ? "" : "s"}` : `${m} minutes`,
}));
const MEETING_TYPE_NAME = { ONSITE: "Onsite", ONLINE: "Online", HYBRID: "Hybrid" };

function Row({ label, hint, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 py-2.5">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-foreground">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

/** One Activity type: name, colour, on or off, who files it, whether it waits for HR, several days. */
function TypeCard({ typeKey, type, onlyOneOn, save, busy }) {
  const change = (changes) => save.mutate({ typeKey, from: type, changes });
  return (
    <section className="rounded-xl border border-border bg-card p-4" data-testid={`activity-type-${typeKey}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden className={cn("size-3 shrink-0 rounded-full", ACTIVITY_COLORS[type.color]?.dot)} />
        <Input
          key={type.name}
          defaultValue={type.name}
          aria-label={`Name of ${type.name}`}
          maxLength={40}
          onBlur={(e) => e.target.value.trim() && change({ name: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          containerClassName="min-w-0 flex-1"
        />
        <span className="w-10 text-right text-xs text-muted-foreground">{type.active ? "On" : "Off"}</span>
        <Switch
          checked={type.active}
          disabled={busy || (type.active && onlyOneOn)}
          aria-label={`${type.name} is on`}
          onCheckedChange={(on) => change({ active: on })}
        />
      </div>
      {type.active && onlyOneOn && <p className="mt-1 text-xs text-muted-foreground">At least one type must stay on.</p>}
      <div className="mt-2 divide-y divide-border">
        <Row label="Colour" hint="Used on the Calendar, in the filter and in the form.">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={`Colour of ${type.name}`}>
            {ACTIVITY_COLOR_KEYS.map((key) => (
              <Button
                key={key}
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={busy}
                aria-label={ACTIVITY_COLORS[key].label}
                aria-pressed={type.color === key}
                onClick={() => change({ color: key })}
                className={cn(
                  "size-6 min-w-0 rounded-full border-2 p-0 transition-shadow hover:opacity-90",
                  ACTIVITY_COLORS[key].dot,
                  type.color === key ? "border-foreground" : "border-transparent hover:border-border",
                )}
              />
            ))}
          </div>
        </Row>
        <Row label="Who can file it">
          <SelectField
            value={type.whoFiles}
            onChange={(v) => change({ whoFiles: v })}
            options={WHO_OPTIONS}
            disabled={busy}
            aria-label={`Who can file ${type.name}`}
            className="w-52"
          />
        </Row>
        {type.whoFiles === "HEADS" && (
          <div className="px-1 py-2.5" data-testid={`activity-also-allowed-${typeKey}`}>
            <p className="text-[13px] font-medium text-foreground">Also allowed</p>
            <p className="text-xs text-muted-foreground">These people can file it too, even though they are not department heads.</p>
            <PeoplePicker
              className="mt-2"
              types={[SELECTOR_TYPES.EMPLOYEE]}
              placeholder="Add person"
              disabled={busy}
              value={(type.alsoAllowed ?? []).map((id) => ({ type: SELECTOR_TYPES.EMPLOYEE, id }))}
              onChange={(selectors) => change({ alsoAllowed: selectors.map((s) => s.id) })}
            />
          </div>
        )}
        <Row
          label="Waits for HR"
          hint={typeKey === "MEETING" ? "Only a Meeting with a Venue waits. Never when HR or a Super Admin files it." : "Never when HR or a Super Admin files it."}
        >
          <Switch checked={type.needsHr} disabled={busy} aria-label={`${type.name} waits for HR`} onCheckedChange={(on) => change({ needsHr: on })} />
        </Row>
        <Row label="Can run over several days">
          <Switch checked={type.multiDay} disabled={busy} aria-label={`${type.name} can run over several days`} onCheckedChange={(on) => change({ multiDay: on })} />
        </Row>
      </div>
    </section>
  );
}

/**
 * Settings > Activities (#1064, spec #1062): the rules for filing an Activity. HR and Super Admins change them;
 * the database refuses everyone else. A change applies to new filings and edits only, never to Activities
 * already filed. Every change is written to the Activity Log.
 */
export default function ActivitySettings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const settings = useActivitySettings();
  const g = settings.general;
  const [maxDaysDraft, setMaxDaysDraft] = useState(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ACTIVITY_SETTINGS_KEY });
  const saveType = useMutation({
    mutationFn: ({ typeKey, from, changes }) => activitySettingsService.saveType(typeKey, from, changes, user?.id),
    onSuccess: () => {
      toast.success("Saved. New filings and edits follow it.");
      return refresh();
    },
    onError: (err) => {
      toast.error(err.message);
      refresh();
    },
  });
  const saveGeneral = useMutation({
    mutationFn: (changes) => activitySettingsService.saveGeneral(g, changes, user?.id),
    onSuccess: () => {
      toast.success("Saved. New filings and edits follow it.");
      setMaxDaysDraft(null);
      return refresh();
    },
    onError: (err) => {
      toast.error(err.message);
      setMaxDaysDraft(null);
      refresh();
    },
  });
  const busy = saveType.isPending || saveGeneral.isPending;
  const typesOn = ACTIVITY_TYPE_KEYS.filter((k) => settings.types[k].active).length;
  const meetingTypesOn = MEETING_TYPE_KEYS.filter((k) => g.meetingTypes[k]).length;

  // The hours and the step move the default times with them, so the database never sees an off-grid default.
  const saveHours = (changes) => {
    const next = fitDefaults({ ...g, ...changes });
    saveGeneral.mutate({ ...changes, defaultStart: next.defaultStart, defaultEnd: next.defaultEnd });
  };
  const options = timesOfDay(g.timeStep);
  const windowOptions = timeOptions(g);

  return (
    <div className="space-y-4" data-testid="activity-settings">
      <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-muted/30 flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-lg bg-muted flex items-center justify-center">
            <CalendarClock size={14} className="text-muted-foreground" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">Activities</h2>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            These are the rules for filing an Activity. A change applies to new filings and edits only. Activities already filed stay as they are.
            A type that is switched off is not offered in the form, but its existing Activities stay.
          </p>

          <h3 className="text-sm font-semibold text-foreground">Activity types</h3>
          <div className="grid gap-3 lg:grid-cols-2">
            {ACTIVITY_TYPE_KEYS.map((key) => (
              <TypeCard key={key} typeKey={key} type={settings.types[key]} onlyOneOn={typesOn <= 1} save={saveType} busy={busy} />
            ))}
          </div>

          <section className="rounded-xl border border-border bg-card p-4 space-y-1">
            <h3 className="text-sm font-semibold text-foreground">Meeting types</h3>
            {MEETING_TYPE_KEYS.map((k) => (
              <Row key={k} label={MEETING_TYPE_NAME[k]}>
                <Switch
                  checked={g.meetingTypes[k]}
                  disabled={busy || (g.meetingTypes[k] && meetingTypesOn <= 1)}
                  aria-label={`${MEETING_TYPE_NAME[k]} meetings are on`}
                  onCheckedChange={(on) => saveGeneral.mutate({ meetingTypes: { [k]: on } })}
                />
              </Row>
            ))}
            {meetingTypesOn <= 1 && <p className="text-xs text-muted-foreground">At least one meeting type must stay on.</p>}
          </section>

          <section className="rounded-xl border border-border bg-card p-4 space-y-1">
            <h3 className="text-sm font-semibold text-foreground">Times</h3>
            <Row label="Earliest start">
              <SelectField
                value={g.earliestStart}
                onChange={(v) => saveHours({ earliestStart: v })}
                options={options.filter((o) => o.value < g.latestEnd)}
                disabled={busy}
                aria-label="Earliest start"
                className="w-28"
              />
            </Row>
            <Row label="Latest end">
              <SelectField
                value={g.latestEnd}
                onChange={(v) => saveHours({ latestEnd: v })}
                options={options.filter((o) => o.value > g.earliestStart)}
                disabled={busy}
                aria-label="Latest end"
                className="w-28"
              />
            </Row>
            <Row label="Time step" hint="The form lists times this far apart.">
              <SelectField
                value={String(g.timeStep)}
                onChange={(v) => {
                  const step = Number(v);
                  // Hours that do not sit on the new step move to the nearest mark inside them.
                  const snap = (t, up) => {
                    const [h, m] = t.split(":").map(Number);
                    const total = h * 60 + m;
                    const snapped = (up ? Math.ceil(total / step) : Math.floor(total / step)) * step;
                    return `${String(Math.floor(snapped / 60)).padStart(2, "0")}:${String(snapped % 60).padStart(2, "0")}`;
                  };
                  saveHours({ timeStep: step, earliestStart: snap(g.earliestStart, true), latestEnd: snap(g.latestEnd, false) });
                }}
                options={STEP_OPTIONS}
                disabled={busy}
                aria-label="Time step"
                className="w-36"
              />
            </Row>
            <Row label="Default start" hint="What a new Activity starts with.">
              <SelectField
                value={g.defaultStart}
                onChange={(v) => saveHours({ defaultStart: v })}
                options={windowOptions.filter((o) => o.value < g.defaultEnd)}
                disabled={busy}
                aria-label="Default start"
                className="w-28"
              />
            </Row>
            <Row label="Default end">
              <SelectField
                value={g.defaultEnd}
                onChange={(v) => saveHours({ defaultEnd: v })}
                options={windowOptions.filter((o) => o.value > g.defaultStart)}
                disabled={busy}
                aria-label="Default end"
                className="w-28"
              />
            </Row>
          </section>

          <section className="rounded-xl border border-border bg-card p-4 space-y-1">
            <h3 className="text-sm font-semibold text-foreground">Reminder, range and Guests</h3>
            <Row label="Reminder" hint="How long before the start it goes out.">
              <SelectField
                value={String(g.reminderMinutes)}
                onChange={(v) => saveGeneral.mutate({ reminderMinutes: Number(v) })}
                options={REMINDER_OPTIONS.some((o) => o.value === String(g.reminderMinutes)) ? REMINDER_OPTIONS : [...REMINDER_OPTIONS, { value: String(g.reminderMinutes), label: `${g.reminderMinutes} minutes` }]}
                disabled={busy}
                aria-label="Reminder"
                className="w-36"
              />
            </Row>
            <Row label="Longest range" hint="The most days one Activity can cover.">
              <FieldBox inline className="gap-2">
                <Input
                  type="number"
                  min={1}
                  max={366}
                  value={maxDaysDraft ?? g.maxDays}
                  disabled={busy}
                  aria-label="Longest range in days"
                  onChange={(e) => setMaxDaysDraft(e.target.value)}
                  onBlur={() => {
                    const days = Math.round(Number(maxDaysDraft));
                    if (maxDaysDraft === null || days === g.maxDays) return setMaxDaysDraft(null);
                    if (!Number.isFinite(days) || days < 1 || days > 366) {
                      toast.error("Enter a number of days from 1 to 366.");
                      return setMaxDaysDraft(null);
                    }
                    saveGeneral.mutate({ maxDays: days });
                  }}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  containerClassName="w-24"
                />
                <span className="text-xs text-muted-foreground">days</span>
              </FieldBox>
            </Row>
            <Row label="Guests" hint="People from outside the company on an Activity.">
              <Switch checked={g.guestsAllowed} disabled={busy} aria-label="Guests are allowed" onCheckedChange={(on) => saveGeneral.mutate({ guestsAllowed: on })} />
            </Row>
          </section>
        </div>
      </div>
    </div>
  );
}
