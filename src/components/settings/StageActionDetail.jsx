import { CalendarClock, ListChecks, User } from "lucide-react";

import { parseChecklist } from "../../utils/checklist";

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
    <div className="mt-0.5 text-xs leading-relaxed text-foreground">{children}</div>
  </div>
);

const Checklist = ({ value }) => {
  const items = parseChecklist(value).filter((item) => item?.text?.trim());
  if (items.length === 0) return null;

  return (
    <Field label={`Checklist · ${items.length}`}>
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={item.id ?? i} className="flex items-start gap-1.5">
            <ListChecks size={12} className="mt-0.5 shrink-0 text-violet-11" />
            <span>{item.text}</span>
          </li>
        ))}
      </ul>
    </Field>
  );
};

export default function StageActionDetail({ action, employees = [] }) {
  const config = action?.config ?? {};
  const nameOf = (id) =>
    employees.find((e) => e.id === id)?.name ?? "Someone no longer listed";

  return (
    <div className="space-y-3 border-t border-mauve-5 px-3 py-3">
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
            <ul className="space-y-2">
              {(config.members ?? []).map((member, i) => (
                <li
                  key={member.employeeId ?? i}
                  className="rounded-lg bg-mauve-a2 px-2.5 py-2"
                >
                  <p className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                    <User size={12} className="shrink-0 text-violet-11" />
                    {nameOf(member.employeeId)}
                    {(member.customRole || member.role) && (
                      <span className="rounded bg-mauve-a3 px-1.5 py-px text-[9px] font-black uppercase tracking-[0.1em] text-mauve-11">
                        {member.customRole || member.role}
                      </span>
                    )}
                  </p>
                  {member.taskDescription?.trim() && (
                    <p className="mt-1 leading-relaxed text-muted-foreground">
                      {member.taskDescription}
                    </p>
                  )}
                  <div className="mt-1">
                    <Checklist value={member.checklist} />
                  </div>
                </li>
              ))}
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

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Saved when the automation was written. To change it, archive this action and add a new
        one — an archived action stops firing, and the tasks it already created stay put.
      </p>
    </div>
  );
}
