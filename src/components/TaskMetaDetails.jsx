import { CheckCircle2, Clock } from "lucide-react";
import Dot from "./ui/Dot";
import { formatDate } from "../utils/formatDate";
import { TASK_STATUS } from "../constants/status";

const PRIORITY_TONE = {
  HIGH: { text: "text-destructive", dot: "bg-destructive" },
  MEDIUM: { text: "text-amber-10", dot: "bg-warning" },
  LOW: { text: "text-muted-foreground", dot: "bg-mauve-6" },
};

function Item({ label, children, wide }) {
  return (
    <div className={wide ? "col-span-2" : undefined}>
      <dt className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-[13px] font-semibold text-foreground break-words">
        {children}
      </dd>
    </div>
  );
}

/**
 * TaskMetaDetails — the who/what of an Individual Task in view mode.
 *
 * Assignees open a task to do it, so the header and body carry the title,
 * description, and checklist; everything about who owns it and how it is
 * filed sits here, quiet and last. Edit mode still uses ManagementSection and
 * StandardDetailsSection, which own the controls.
 */
export default function TaskMetaDetails({ task, formData, categoryLabel }) {
  const priority = task.priority || "LOW";
  const tone = PRIORITY_TONE[priority] || PRIORITY_TONE.LOW;
  const org = [formData.department, formData.subDepartment]
    .filter(Boolean)
    .join(" · ");

  return (
    <section aria-label="Task details" className="pt-5 border-t border-border">
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
        <Item label="Assignee">{task.loggedByName || "—"}</Item>
        {task.reportedToName && (
          <Item label="Reported To">{task.reportedToName}</Item>
        )}
        <Item label="Department">{org || "—"}</Item>
        <Item label="Category" wide>
          {task.categoryId ? (
            <>
              <span className="font-mono text-xs">{task.categoryId}</span>
              <span className="font-medium text-muted-foreground">
                {" "}
                – {categoryLabel}
              </span>
            </>
          ) : (
            "—"
          )}
        </Item>
        <Item label="Priority">
          <span className={`inline-flex items-center gap-1.5 ${tone.text}`}>
            <Dot size="w-2 h-2" color={tone.dot} />
            {priority}
          </span>
        </Item>
        <Item label="Start">{formatDate(task.startAt)}</Item>
        <Item label="End">{formatDate(task.endAt)}</Item>
        <Item label="HR Verification">
          {task.status !== TASK_STATUS.COMPLETE ? (
            <span className="font-medium text-muted-foreground">
              Awaiting manager
            </span>
          ) : task.hrVerified ? (
            <span className="inline-flex items-center gap-1.5 text-green-10">
              <CheckCircle2 size={14} /> Verified
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-amber-10">
              <Clock size={14} /> Pending HR audit
            </span>
          )}
        </Item>
      </dl>
    </section>
  );
}
