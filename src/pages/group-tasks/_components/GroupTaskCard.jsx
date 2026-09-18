import { CheckCircle2, Calendar, Clock, AlertTriangle } from "lucide-react";
import StatusBadge from "../../../components/StatusBadge";
import { formatChecklistToString, formatTaskPreview } from "../../../utils/taskFormatters";
import GradeSelector from "../../../components/GradeSelector";
import Avatar from "../../../components/Avatar";
import AvatarGroup from "../../../components/AvatarGroup";
import { formatDueDate } from "../../../utils/formatDate";
import { useEmployeeAvatarMap } from "../../../hooks/useEmployeeAvatarMap";
import HighlightText from "../../../components/HighlightText";
import { TagPill } from "../../../components/ui/TagPill";
import { SorLinkChip } from "../../../components/ui/SorLinkChip";


export default function GroupTaskCard({
  task,
  onView,
  currentUserId,
  isSuperAdmin,
  searchTerm,
  demoProgress,
}) {

  const members = task.members || [];
  const totalMembers = members.length;
  const completedMembers = members.filter((m) => m.status === "DONE").length;
  const progressPercent =
    totalMembers > 0 ? Math.round((completedMembers / totalMembers) * 100) : 0;

  const avatarMap = useEmployeeAvatarMap();

  // Build people array for AvatarGroup from members (employee sub-join has avatar_path)
  const memberPeople = members.map((m) => ({
    id: m.employee_id,
    name: m.employee?.name || "Member",
    picture: avatarMap.get(m.employee_id) ?? null,
  }));

  // Determine user's specific subtask if they are a member
  const myMember = members.find((m) => m.employee_id === currentUserId);
  const isCreator = task.created_by === currentUserId;

  const isHrPending = task.status === "HR_PENDING";
  const isHrVerified = task.status === "HR_VERIFIED";

  return (
    <div
      onClick={onView}
      className="bg-card p-5 rounded-2xl border border-border shadow-sm hover:shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:-translate-y-1 transition-all duration-300 group flex flex-col h-full cursor-pointer relative"
    >
      <div className="flex justify-between items-start gap-4 mb-3 w-full">
        <h3 className="font-bold text-foreground line-clamp-2 break-words min-w-0 flex-1 leading-snug group-hover:text-primary transition-colors">
          <HighlightText text={task.title} search={searchTerm} />
        </h3>

        <div className="shrink-0 flex items-center gap-1.5">
          <StatusBadge
            status={isHrPending || isHrVerified ? "COMPLETED" : task.status}
          />
          {(isHrPending || isHrVerified) && (
            <div
              title={
                isHrVerified ? "Verified by HR" : "Pending HR Verification"
              }
            >
              {isHrVerified ? (
                <CheckCircle2 size={12} className="text-green-9" />
              ) : (
                <Clock size={12} className="text-amber-9" />
              )}
            </div>
          )}
        </div>
      </div>

      <p className="text-[11px] font-bold text-muted-foreground line-clamp-2 break-words mb-2 flex-1 uppercase tracking-wider opacity-60 w-full">
        <HighlightText text={task.description || "No description provided."} search={searchTerm} />
      </p>

      {(task.opportunity || (task.tags && task.tags.length > 0)) && (
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          <SorLinkChip opportunityId={task.opportunity_id} opportunity={task.opportunity} />
          {(task.tags || [])
            .filter((t) => !t.archived_at)
            .map((tag) => (
              <TagPill key={tag.id} tag={tag} />
            ))}
        </div>
      )}

      {/* HR Rejected Banner */}
      {task.status === "ACTIVE" && task.hr_remarks && (
        <div className="flex items-center gap-1.5 mb-3 px-2.5 py-1.5 bg-destructive/10 border border-red-500/20 rounded-lg text-[10px] font-bold text-destructive uppercase tracking-wider">
          <AlertTriangle size={11} />
          HR Rejected — Resubmit Required
        </div>
      )}


      {(isCreator || isSuperAdmin) && task.status !== "CANCELLED" && (
        <div className="mb-4">
          <div className="flex justify-between text-xs mb-1.5 font-medium">
            <span className="text-muted-foreground">Progress</span>
            <span className="text-mauve-11">
              {completedMembers} / {totalMembers} members done
            </span>
          </div>
          <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${demoProgress ?? progressPercent}%`,
                background: `hsl(${(demoProgress ?? progressPercent) * 1.2}, 80%, 45%)`,
              }}
            />
          </div>
        </div>
      )}

      {/* My Assigned Task (Visible to Members) */}
      {myMember && !isCreator && !isSuperAdmin && (
        <div className="mb-4 bg-muted/30 p-3.5 rounded-xl border border-border/40 hover:border-border/80 transition-colors w-full min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <div className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.1em] truncate">
              My Task
            </div>
            {myMember.role && (
              <span className="text-[9px] font-bold bg-mauve-4 text-mauve-11 dark:text-muted-foreground px-2 py-0.5 rounded uppercase tracking-wider border border-mauve-5 shrink-0">
                {myMember.custom_role || myMember.role}
              </span>
            )}
          </div>
          <p className="text-sm font-bold text-foreground line-clamp-2 break-words mb-3 leading-tight">
            <HighlightText
              text={
                myMember.task_description?.trim()
                  ? formatChecklistToString(myMember.task_description)
                  : formatTaskPreview(myMember.task_description, myMember.checklist)
              }
              search={searchTerm}
            />
          </p>

          <div className="flex items-center justify-between mt-2">
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                myMember.status === "DONE"
                  ? "bg-green-9/10 text-green-10"
                  : "bg-warning/10 text-amber-10"
              }`}
            >
              {myMember.status}
            </span>
            {myMember.grade > 0 && (
              <GradeSelector grade={myMember.grade} finalized compact />
            )}
          </div>
        </div>
      )}

      <div className="mt-auto pt-4 border-t border-border flex items-center justify-between gap-2 text-xs text-muted-foreground font-medium">
        <div className="flex items-center gap-1.5 min-w-0" title="Head/Creator">
          <Avatar
            name={task.creator?.name || "Unknown"}
            size="xs"
            src={avatarMap.get(task.created_by) ?? undefined}
            className="shadow-inner bg-mauve-2 text-mauve-10 border-mauve-4 shrink-0"
          />
          <span className="truncate max-w-[80px] text-foreground/80 font-semibold">
            {task.creator?.name || "Unknown"}
          </span>
        </div>

        {/* Member stacked avatars */}
        {memberPeople.length > 0 && (
          <AvatarGroup people={memberPeople} max={4} size="xs" />
        )}

        {task.due_date && (
          <div className="flex items-center gap-1.5 shrink-0" title="Due Date">
            <Calendar
              size={14}
              className={
                new Date(task.due_date) < new Date() && task.status === "ACTIVE"
                  ? "text-destructive"
                  : "text-muted-foreground"
              }
            />
            <span
              className={
                new Date(task.due_date) < new Date() && task.status === "ACTIVE"
                  ? "text-destructive"
                  : ""
              }
            >
              {formatDueDate(task.due_date)}
            </span>
          </div>
        )}
      </div>

    </div>
  );
}
