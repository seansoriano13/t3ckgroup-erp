import { Plus, Trash2, AlertCircle, CheckCircle2 } from "lucide-react";
import Avatar from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import { resolveAssignment } from "@/utils/checklist";
import { cn } from "@/lib/utils";

/**
 * GroupTaskMemberRail — the master half of the group task master/detail layout.
 *
 * Replaces the old two-column grid of member cards. That grid squeezed every
 * field of every member onto the screen at once, and adding a checklist to each
 * assignment only made it worse. Here each member is one compact row and the
 * editing surface belongs to whichever row is selected.
 *
 * The current user is pinned to the top and selected on open: in the detail
 * view the row a member actually came to act on is their own, and hunting for
 * it in a list of eight is pure friction.
 */
export default function GroupTaskMemberRail({
  members,
  selectedId,
  onSelect,
  onAdd,
  onRemove,
  currentUserId,
  resolveEmployee,
  avatarMap,
  mode = "create",
  className,
}) {
  return (
    <div className={cn("flex flex-col h-full min-h-0 border-r border-border bg-muted/20", className)}>
      <div className="px-4 pt-4 pb-2 shrink-0">
        <h3 className="text-label font-bold text-muted-foreground uppercase tracking-widest">
          Members{" "}
          <span className="text-muted-foreground/60">({members.length})</span>
        </h3>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2 custom-scrollbar min-h-0">
        {members.map((member) => {
          const employee = resolveEmployee?.(member);
          // Guarded against a null id on both sides: a member list that lost
          // its ids would otherwise match `undefined === undefined` and light
          // up every row at once instead of none.
          const isSelected = member.id != null && member.id === selectedId;
          const isMe =
            currentUserId && (member.employeeId ?? member.employee_id) === currentUserId;

          // Resolved so pre-0016 rows, whose checklist still lives in
          // task_description, show a real progress count instead of 0.
          const { description, checklist } = resolveAssignment(member);
          const total = checklist.length;
          const checked = checklist.filter((i) => i?.checked).length;
          const hasDescription = !!description?.trim();
          // In create mode a row is only submittable once it has an assignee
          // and something for them to do; flag the gap here rather than letting
          // handleSubmit silently drop the row later.
          const isIncomplete =
            mode === "create" && (!(member.employeeId ?? member.employee_id) || (!hasDescription && total === 0));

          const status = member.status;

          return (
            <Button
              key={member.id}
              type="button"
              variant="ghost"
              onClick={() => onSelect(member.id)}
              className={`group relative h-auto w-full items-start justify-start gap-2.5 rounded-xl px-2.5 py-2.5 mb-1 text-left font-normal ${
                isSelected
                  ? "bg-card shadow-sm ring-1 ring-mauve-4 hover:bg-card"
                  : "hover:bg-muted/60"
              } ${member.isRemoving ? "opacity-0 scale-95" : "opacity-100 scale-100"}`}
            >
              <Avatar
                name={employee?.name || "?"}
                src={avatarMap?.get(employee?.id) ?? undefined}
                size="sm"
                className="shrink-0 mt-0.5"
              />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-[13px] font-semibold truncate ${
                      employee?.name ? "text-foreground" : "text-mauve-7 italic"
                    }`}
                  >
                    {employee?.name || "Select employee…"}
                  </span>
                  {isMe && (
                    <span className="text-[9px] font-bold text-primary shrink-0">
                      YOU
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                  {(member.customRole || member.custom_role || member.role) && (
                    <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border truncate max-w-[120px]">
                      {member.customRole || member.custom_role || member.role}
                    </span>
                  )}
                  {total > 0 && (
                    <span className="text-[9px] font-bold text-muted-foreground tabular-nums">
                      {checked}/{total}
                    </span>
                  )}
                  {status === "DONE" && (
                    <CheckCircle2 size={11} className="text-green-500 shrink-0" />
                  )}
                  {isIncomplete && (
                    <AlertCircle
                      size={11}
                      className="text-amber-500 shrink-0"
                      aria-label="Incomplete"
                    />
                  )}
                </div>
              </div>

              {onRemove && members.length > 1 && (
                <span
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(member.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive p-1 rounded-md hover:bg-destructive/10 shrink-0"
                >
                  <Trash2 size={13} />
                </span>
              )}
            </Button>
          );
        })}
      </div>

      {onAdd && (
        <div className="p-2 border-t border-border shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={onAdd}
            className="h-auto w-full gap-2 rounded-xl border-2 border-dashed border-primary/25 py-2.5 text-[11px] font-bold text-primary hover:border-primary/40 hover:bg-primary/5"
          >
            <Plus size={15} /> Add member
          </Button>
        </div>
      )}
    </div>
  );
}
