import { CalendarClock, ListChecks } from "lucide-react";

import Avatar from "../Avatar";
import AccessWindowConfig from "./AccessWindowConfig";
import { DEFAULT_ACCESS } from "../../utils/stageAudience";
import { parseChecklist } from "../../utils/checklist";
import { Switch } from "../ui/switch";

/**
 * What an action will actually create, read back from the config it was saved
 * with.
 *
 * An automation is written once through a full task modal and then never seen
 * again — the row above it says only its name and kind, which is not enough to
 * answer "who does this assign, and what does it ask them to do?". This reads
 * the stored payload rather than re-opening the modal, so a Super Admin can
 * check an automation without any risk of re-submitting it.
 *
 * The two kinds store what their own modal submits, so each is rendered on its
 * own terms rather than through a shared shape neither of them has.
 */

const Field = ({ label, children }) => (
  <div className="min-w-0">
    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-muted-foreground">
      {label}
    </p>
    <div className="mt-1.5 text-xs leading-relaxed text-foreground">{children}</div>
  </div>
);

const Checklist = ({ value }) => {
  const items = parseChecklist(value).filter((item) => item?.text?.trim());
  if (items.length === 0) return null;

  return (
    <Field label={`Checklist · ${items.length}`}>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={item.id ?? i} className="flex items-start gap-2.5">
            <ListChecks size={14} className="mt-px shrink-0 text-violet-11" />
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
    </Field>
  );
};

const deciderLabel = (selector, nameOf) => {
  if (selector.type === "employee") return nameOf(selector.id);
  if (selector.type === "team") return `Everyone in ${selector.team}`;
  if (selector.type === "role") return String(selector.role || "").replace(/_/g, " ");
  if (selector.type === "group") return "an Employee Group";
  return "someone";
};

export default function StageActionDetail({
  action,
  employees = [],
  stageId,
  disabled = false,
  onAccessChange,
  onCarriesOnChange,
}) {
  const config = action?.config ?? {};
  const nameOf = (id) =>
    employees.find((e) => e.id === id)?.name ?? "Someone no longer listed";
  const employeeOf = (id) => employees.find((e) => e.id === id);

  const assigneeNames = (config.members || [])
    .map((member) => member?.employeeId)
    .filter(Boolean)
    .map(nameOf);
  const subjectLabel =
    assigneeNames.length === 0
      ? null
      : assigneeNames.length <= 2
        ? assigneeNames.join(" and ")
        : `${assigneeNames[0]} and ${assigneeNames.length - 1} others`;

  return (
    <div className="space-y-5 border-t border-mauve-5 px-4 py-5">
      {/* Issue #204 Part 2 — the same confirmMode/decider config the modal
          writes, read back here so it's verifiable without re-opening the
          modal (see the file doc comment on why this panel exists at all). */}
      <Field label="Trigger">
        {config.confirmMode === "confirm" ? (
          <>
            Waits for confirmation ·{" "}
            {(config.decider?.length ? config.decider : [{ type: "role", role: "deal_owner" }])
              .map((s) => deciderLabel(s, nameOf))
              .join(", ")}{" "}
            decides
          </>
        ) : (
          "Runs automatically when the deal arrives"
        )}
      </Field>

      {action.kind === "create_group_task" ? (
        <>
          {config.description?.trim() && (
            <Field label="Objective">{config.description}</Field>
          )}

          {config.dueDateOffsetDays ? (
            <Field label="Due">
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock size={12} className="text-violet-11" />
                {config.dueDateOffsetDays} day
                {Number(config.dueDateOffsetDays) === 1 ? "" : "s"} after the deal arrives
              </span>
            </Field>
          ) : (
            <Field label="Due">No deadline</Field>
          )}

          <Field label={`Assignees · ${config.members?.length ?? 0}`}>
            <ul className="mt-2 space-y-3">
              {(config.members ?? []).map((member, i) => {
                const employee = employeeOf(member.employeeId);
                return (
                  <li
                    key={member.employeeId ?? i}
                    className="flex items-start gap-3 rounded-xl bg-mauve-a2 p-4"
                  >
                    <Avatar name={employee?.name} src={employee?.avatarPath} size="md" />
                    <div className="min-w-0 flex-1 space-y-3">
                      <div className="space-y-1.5">
                        <p className="text-[13px] font-bold leading-tight text-foreground">
                          {nameOf(member.employeeId)}
                        </p>
                        {(member.customRole || member.role) && (
                          <span className="inline-block rounded bg-mauve-a3 px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.1em] text-mauve-11">
                            {member.customRole || member.role}
                          </span>
                        )}
                      </div>
                      {member.taskDescription?.trim() && (
                        <p className="leading-relaxed text-muted-foreground">
                          {member.taskDescription}
                        </p>
                      )}
                      <Checklist value={member.checklist} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Field>
        </>
      ) : (
        <>
          {config.taskDescription?.trim() && (
            <Field label="Task">{config.taskDescription}</Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            {config.priority && (
              <Field label="Priority">{String(config.priority).toLowerCase()}</Field>
            )}
            {config.reportedTo && <Field label="Reports to">{nameOf(config.reportedTo)}</Field>}
          </div>

          {config.remarks?.trim() && <Field label="Remarks">{config.remarks}</Field>}
          {config.paymentVoucher && (
            <Field label="Payment voucher">{config.paymentVoucher}</Field>
          )}

          <Checklist value={config.checklist} />
        </>
      )}

      {onCarriesOnChange && (
        <div className="flex items-center justify-between gap-4 rounded-xl bg-mauve-a2 p-4">
          <div className="min-w-0">
            <p className="text-[13px] font-bold text-foreground">Keep going after this stage</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {config.carries_on === true
                ? "Stays active after the SOR moves on."
                : "Pauses when the SOR moves to another stage."}
            </p>
          </div>
          <Switch
            className="shrink-0"
            aria-label="Keep going after this stage"
            checked={config.carries_on === true}
            disabled={disabled}
            onCheckedChange={(checked) => onCarriesOnChange(checked)}
          />
        </div>
      )}

      {/* The access window lives here, after the automation it applies to,
          rather than in a step that had to be cleared before the automation
          could be read at all. Editable in place: nothing about changing who
          can see the SOR requires re-opening the task modal. */}
      {onAccessChange && (
        <AccessWindowConfig
          stageId={stageId}
          value={config.access || DEFAULT_ACCESS}
          onChange={onAccessChange}
          disabled={disabled}
          subjectLabel={subjectLabel}
        />
      )}
    </div>
  );
}
