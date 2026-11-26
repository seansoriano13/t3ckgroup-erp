import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Layers, SlidersHorizontal } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { SelectField } from "@/components/ui/SelectField";
import { Tooltip } from "@/components/ui/Tooltip";
import PeoplePicker from "@/components/ui/PeoplePicker";
import Reveal from "@/components/record/Reveal";
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

// The type list's columns, shared by the heading row and every type row so they line up.
const TYPE_COLUMNS = "@2xl:grid-cols-[minmax(0,1fr)_10.5rem_7.5rem_7rem]";

/** What one type allows, in the words the columns use. */
function typeFacts(typeKey, type) {
  const extra = type.alsoAllowed?.length ?? 0;
  const who = type.whoFiles === "EVERYONE" ? "Everyone" : extra ? `Department heads + ${extra}` : "Department heads";
  // Only a Meeting with a Venue waits (CONTEXT.md, Activity type), so the list says so.
  const hr = !type.needsHr ? "No" : typeKey === "MEETING" ? "With a Venue" : "Yes";
  const length = type.multiDay ? "Several days" : "One day";
  return { who, hr, length };
}

/** One settings block, in the same frame as the other Settings tabs: a header band, then the body. */
function SettingsBlock({ icon: Icon, title, aside, description, testId, children }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm" data-testid={testId} aria-label={title}>
      <header className="border-b border-border bg-muted/30 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex size-6 items-center justify-center rounded-lg bg-muted">
            <Icon size={14} className="text-muted-foreground" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {aside && <span className="ml-auto text-xs font-medium text-muted-foreground tabular-nums">{aside}</span>}
        </div>
        {description && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{description}</p>}
      </header>
      <div className="@container">{children}</div>
    </section>
  );
}

/** A setting: its name and a short line on what it does on the left, the control on the right. */
function Row({ label, hint, children, className }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3", className)}>
      {/* The label grows from 14rem, so a small control (a switch) stays beside it on a phone and a wide one wraps under. */}
      <div className="min-w-0 max-w-md flex-1 basis-56">
        <p className="text-[13px] font-medium text-foreground">{label}</p>
        {hint && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** A from-to pair of time pickers on one line. */
function TimeRange({ children }) {
  return <div className="flex items-center gap-2">{children}</div>;
}

const To = () => <span className="text-xs text-muted-foreground">to</span>;

/** The detail of one type, opened in place under its row. */
function TypeEditor({ typeKey, type, change, busy, general, saveGeneral, meetingTypesOn }) {
  return (
    <div className="divide-y divide-border/70 border-t border-border bg-muted/25 px-5 pl-12 @max-md:pl-5">
      <Row label="Name">
        <Input
          key={type.name}
          defaultValue={type.name}
          aria-label={`Name of ${type.name}`}
          maxLength={40}
          onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== type.name && change({ name: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          containerClassName="w-64 max-w-full"
        />
      </Row>
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
                "size-6 min-w-0 rounded-full p-0 ring-offset-2 ring-offset-card transition-shadow hover:opacity-90",
                ACTIVITY_COLORS[key].dot,
                type.color === key && "ring-2 ring-foreground",
              )}
            />
          ))}
        </div>
      </Row>
      <div>
        <Row label="Who can file it">
          <SelectField
            value={type.whoFiles}
            onChange={(v) => change({ whoFiles: v })}
            options={WHO_OPTIONS}
            disabled={busy}
            size="sm"
            aria-label={`Who can file ${type.name}`}
            className="w-56"
          />
        </Row>
        {type.whoFiles === "HEADS" && (
          <div className="pb-3" data-testid={`activity-also-allowed-${typeKey}`}>
            <p className="text-[13px] font-medium text-foreground">Also allowed</p>
            <p className="mt-0.5 text-xs text-muted-foreground">These people can file it too, even though they are not department heads.</p>
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
      </div>
      <Row
        label="Waits for HR"
        hint={typeKey === "MEETING" ? "Only a Meeting with a Venue waits. Never when HR or a Super Admin files it." : "Never when HR or a Super Admin files it."}
      >
        <Switch checked={type.needsHr} disabled={busy} aria-label={`${type.name} waits for HR`} onCheckedChange={(on) => change({ needsHr: on })} />
      </Row>
      <Row label="Can run over several days" hint={type.multiDay ? `Up to ${general.maxDays} days, the longest range set below.` : null}>
        <Switch checked={type.multiDay} disabled={busy} aria-label={`${type.name} can run over several days`} onCheckedChange={(on) => change({ multiDay: on })} />
      </Row>
      {typeKey === "MEETING" && (
        <Row label="Meeting types" hint="The ones a Meeting can be.">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2" role="group" aria-label="Meeting types">
            {MEETING_TYPE_KEYS.map((k) => {
              const lastOne = general.meetingTypes[k] && meetingTypesOn <= 1;
              return (
                <Tooltip key={k} content={lastOne ? "At least one meeting type must stay on." : null}>
                  <span className="inline-flex">
                    <FieldBox inline className={cn("text-[13px] font-medium text-foreground", lastOne && "cursor-not-allowed")}>
                      <Checkbox
                        tone="neutral"
                        checked={general.meetingTypes[k]}
                        disabled={busy || lastOne}
                        onCheckedChange={(on) => saveGeneral.mutate({ meetingTypes: { [k]: on } })}
                      />
                      {MEETING_TYPE_NAME[k]}
                    </FieldBox>
                  </span>
                </Tooltip>
              );
            })}
          </div>
        </Row>
      )}
    </div>
  );
}

/** One Activity type as a row: what it allows at a glance, its switch, and its detail under it when opened. */
function TypeRow({ typeKey, type, open, onToggle, onlyOneOn, save, busy, general, saveGeneral, meetingTypesOn }) {
  const change = (changes) => save.mutate({ typeKey, from: type, changes });
  const facts = typeFacts(typeKey, type);
  const editorId = `activity-type-editor-${typeKey}`;
  const lastOne = type.active && onlyOneOn;
  const off = !type.active;
  return (
    <li data-testid={`activity-type-${typeKey}`} data-open={open}>
      <div className={cn("flex items-center gap-3 px-5 transition-colors hover:bg-muted/30", open && "bg-muted/25")}>
        <Button
          type="button"
          variant="ghost"
          aria-expanded={open}
          aria-controls={editorId}
          onClick={onToggle}
          className="h-auto min-w-0 flex-1 justify-start gap-3 whitespace-normal rounded-lg px-0 py-3 text-left font-normal hover:bg-transparent aria-expanded:bg-transparent"
        >
          <ChevronRight size={16} className={cn("shrink-0 text-muted-foreground transition-transform duration-200 ease-out", open && "rotate-90")} />
          <div className={cn("grid min-w-0 flex-1 items-center gap-x-4", TYPE_COLUMNS)}>
            <div className="flex min-w-0 items-center gap-2.5">
              <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", ACTIVITY_COLORS[type.color]?.dot, off && "opacity-40")} />
              <span className={cn("truncate text-sm font-semibold", off ? "text-muted-foreground" : "text-foreground")}>{type.name}</span>
              {off && <span className="shrink-0 text-xs font-medium text-muted-foreground">Off</span>}
            </div>
            <p className="col-span-full mt-0.5 pl-5 text-xs text-muted-foreground @2xl:hidden">
              {[facts.who, type.needsHr ? `Waits for HR${typeKey === "MEETING" ? " with a Venue" : ""}` : null, facts.length].filter(Boolean).join(" · ")}
            </p>
            <span className={cn("hidden truncate text-[13px] @2xl:block", off ? "text-muted-foreground" : "text-foreground")}>{facts.who}</span>
            <span className={cn("hidden text-[13px] @2xl:block", !type.needsHr || off ? "text-muted-foreground" : "font-medium text-foreground")}>{facts.hr}</span>
            <span className={cn("hidden text-[13px] @2xl:block", off ? "text-muted-foreground" : "text-foreground")}>{facts.length}</span>
          </div>
        </Button>
        <div className="flex w-10 shrink-0 justify-end">
          <Tooltip content={lastOne ? "At least one type must stay on." : null}>
            <span className="inline-flex">
              <Switch checked={type.active} disabled={busy || lastOne} aria-label={`${type.name} is on`} onCheckedChange={(on) => change({ active: on })} />
            </span>
          </Tooltip>
        </div>
      </div>
      <Reveal open={open} id={editorId}>
        <TypeEditor typeKey={typeKey} type={type} change={change} busy={busy} general={general} saveGeneral={saveGeneral} meetingTypesOn={meetingTypesOn} />
      </Reveal>
    </li>
  );
}

/**
 * Settings > Activities (#1064, spec #1062): the rules for filing an Activity. HR and Super Admins change them;
 * the database refuses everyone else. A change applies to new filings and edits only, never to Activities
 * already filed. Every change is written to the Activity Log.
 *
 * Two blocks: the types, one row each (a new type adds a row, nothing else), with a type's detail opening in
 * place; then the rules every type shares.
 */
export default function ActivitySettings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const settings = useActivitySettings();
  const g = settings.general;
  const [maxDaysDraft, setMaxDaysDraft] = useState(null);
  const [openType, setOpenType] = useState(null);

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
      <p className="text-xs leading-relaxed text-muted-foreground">
        These are the rules for filing an Activity. A change applies to new filings and edits only. Activities already filed stay as they are.
      </p>

      <SettingsBlock
        icon={Layers}
        title="Activity types"
        aside={`${typesOn} of ${ACTIVITY_TYPE_KEYS.length} on`}
        description="Open a type to change its name, colour and rules. A type that is off is not offered in the form, but its existing Activities stay."
        testId="activity-types"
      >
        <div className="hidden items-center gap-3 border-b border-border px-5 py-2 @2xl:flex" aria-hidden>
          <span className="w-4 shrink-0" />
          <div className={cn("grid flex-1 gap-x-4 text-label font-bold uppercase tracking-wider text-muted-foreground", TYPE_COLUMNS)}>
            <span>Type</span>
            <span>Who can file</span>
            <span>Waits for HR</span>
            <span>Length</span>
          </div>
          <span className="w-10 shrink-0 text-right text-label font-bold uppercase tracking-wider text-muted-foreground">On</span>
        </div>
        <ul className="divide-y divide-border">
          {ACTIVITY_TYPE_KEYS.map((key) => (
            <TypeRow
              key={key}
              typeKey={key}
              type={settings.types[key]}
              open={openType === key}
              onToggle={() => setOpenType((cur) => (cur === key ? null : key))}
              onlyOneOn={typesOn <= 1}
              save={saveType}
              busy={busy}
              general={g}
              saveGeneral={saveGeneral}
              meetingTypesOn={meetingTypesOn}
            />
          ))}
        </ul>
      </SettingsBlock>

      <SettingsBlock icon={SlidersHorizontal} title="Rules for every type" testId="activity-general">
        <div className="divide-y divide-border px-5">
          <Row label="Hours" hint="The form offers times inside these hours.">
            <TimeRange>
              <SelectField
                value={g.earliestStart}
                onChange={(v) => saveHours({ earliestStart: v })}
                options={options.filter((o) => o.value < g.latestEnd)}
                disabled={busy}
                size="sm"
                aria-label="Earliest start"
                className="w-28"
              />
              <To />
              <SelectField
                value={g.latestEnd}
                onChange={(v) => saveHours({ latestEnd: v })}
                options={options.filter((o) => o.value > g.earliestStart)}
                disabled={busy}
                size="sm"
                aria-label="Latest end"
                className="w-28"
              />
            </TimeRange>
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
              size="sm"
              aria-label="Time step"
              className="w-36"
            />
          </Row>
          <Row label="Default time" hint="What a new Activity starts with.">
            <TimeRange>
              <SelectField
                value={g.defaultStart}
                onChange={(v) => saveHours({ defaultStart: v })}
                options={windowOptions.filter((o) => o.value < g.defaultEnd)}
                disabled={busy}
                size="sm"
                aria-label="Default start"
                className="w-28"
              />
              <To />
              <SelectField
                value={g.defaultEnd}
                onChange={(v) => saveHours({ defaultEnd: v })}
                options={windowOptions.filter((o) => o.value > g.defaultStart)}
                disabled={busy}
                size="sm"
                aria-label="Default end"
                className="w-28"
              />
            </TimeRange>
          </Row>
          <Row label="Reminder">
            <SelectField
              value={String(g.reminderMinutes)}
              onChange={(v) => saveGeneral.mutate({ reminderMinutes: Number(v) })}
              options={REMINDER_OPTIONS.some((o) => o.value === String(g.reminderMinutes)) ? REMINDER_OPTIONS : [...REMINDER_OPTIONS, { value: String(g.reminderMinutes), label: `${g.reminderMinutes} minutes` }]}
              disabled={busy}
              size="sm"
              aria-label="Reminder"
              className="w-36"
            />
            <span className="text-xs text-muted-foreground">before the start</span>
          </Row>
          <Row label="Longest range" hint="The most days one Activity can cover.">
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
              containerClassName="w-20"
              className="tabular-nums"
            />
            <span className="text-xs text-muted-foreground">days</span>
          </Row>
          <Row label="Guests" hint="People from outside the company on an Activity.">
            <Switch checked={g.guestsAllowed} disabled={busy} aria-label="Guests are allowed" onCheckedChange={(on) => saveGeneral.mutate({ guestsAllowed: on })} />
          </Row>
        </div>
      </SettingsBlock>
    </div>
  );
}
