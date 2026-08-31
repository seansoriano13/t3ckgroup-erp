import { Users, Lock, Settings2 } from "lucide-react";
import Dropdown from "@/components/ui/Dropdown";
import { FilterTrigger, FilterOptionList } from "@/components/ui/FilterDropdown";
import RoleDropdown from "@/components/dropdowns/RoleDropdown";
import ChecklistTaskInput from "@/components/ChecklistTaskInput";
import { resolveAssignment } from "@/utils/checklist";

/**
 * GroupTaskMemberPanel — the detail half of the master/detail layout.
 *
 * Shared by the create and detail modals so the two cannot drift apart. The
 * detail modal's extra affordances (mark done, grade, per-member activity) come
 * in through `children` rather than being duplicated here.
 *
 * Description and checklist are both present at once, matching how regular
 * tasks work. The old Text/Checklist toggle forced a choice between them and
 * was never persisted anyway — every reader had to guess which one it was
 * looking at by sniffing for a leading '['.
 */
export default function GroupTaskMemberPanel({
  member,
  employeeOptions = [],
  roles = [],
  isRolesLoading = false,
  onManageRoles,
  onChange,
  canEditAssignment = true,
  canEditDescription = true,
  canEditChecklist = true,
  lockedReason,
  children,
}) {
  if (!member) {
    return (
      <div className="flex-1 flex items-center justify-center text-[13px] text-muted-foreground">
        Select a member to edit their assignment.
      </div>
    );
  }

  const employeeId = member.employeeId ?? member.employee_id ?? null;
  // Read through resolveAssignment so a row predating the 0016 backfill — its
  // checklist still serialised inside task_description — does not show raw JSON
  // in the description box.
  const { description, checklist: checklistItems } = resolveAssignment(member);
  const showChecklist = checklistItems.length > 0 || member.showChecklist;
  const role = member.role || "";
  const customRole = member.customRole ?? member.custom_role ?? "";

  return (
    <div className="flex-1 overflow-y-auto min-h-0 custom-scrollbar px-6 py-5 flex flex-col gap-5">
      {/* Assignee */}
      <div className="flex flex-col gap-1.5">
        <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
          Assignee
        </label>
        {canEditAssignment ? (
          <Dropdown
            usePortal
            className="w-full max-w-sm"
            trigger={({ isOpen }) => (
              <FilterTrigger
                label={
                  employeeOptions.find((o) => o.value === employeeId)?.label ||
                  "Select Employee…"
                }
                isActive={!!employeeId}
                isOpen={isOpen}
                icon={Users}
              />
            )}
          >
            {({ close }) => (
              <FilterOptionList
                options={employeeOptions}
                value={employeeId}
                onChange={(val) => {
                  onChange("employeeId", val);
                  close();
                }}
                close={close}
              />
            )}
          </Dropdown>
        ) : (
          <p className="text-[13px] font-semibold text-foreground">
            {employeeOptions.find((o) => o.value === employeeId)?.label || "—"}
          </p>
        )}
      </div>

      {/* Role */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between max-w-sm">
          <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
            Role (optional)
          </label>
          {canEditAssignment && onManageRoles && (
            <button
              type="button"
              onClick={onManageRoles}
              className="text-muted-foreground hover:text-foreground px-1.5 py-0.5 rounded-md hover:bg-muted transition-colors flex items-center gap-1 text-[9px] font-bold uppercase cursor-pointer"
              title="Manage Roles"
            >
              <Settings2 size={11} /> Manage
            </button>
          )}
        </div>
        {canEditAssignment ? (
          <>
            <RoleDropdown
              usePortal
              className="w-full max-w-sm"
              value={role}
              roles={roles}
              isLoading={isRolesLoading}
              onManage={onManageRoles}
              onChange={(val) => {
                onChange("role", val);
                if (val !== "OTHERS") onChange("customRole", "");
              }}
            />
            {role === "OTHERS" && (
              <div className="animate-slide-down mt-1 max-w-sm">
                <input
                  type="text"
                  value={customRole}
                  onChange={(e) => onChange("customRole", e.target.value)}
                  placeholder="Specify custom role…"
                  className="w-full bg-card border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 transition-colors"
                />
              </div>
            )}
          </>
        ) : (
          <p className="text-[13px] font-semibold text-foreground">
            {customRole || role || "—"}
          </p>
        )}
      </div>

      {/* Description */}
      <div className="flex flex-col gap-1.5">
        <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
          Specific Task
        </label>
        <textarea
          value={description}
          onChange={(e) => onChange("taskDescription", e.target.value)}
          disabled={!canEditDescription}
          placeholder="What exactly are they responsible for?"
          className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-[13px] text-foreground outline-none focus:border-primary/50 transition-colors h-28 resize-y disabled:opacity-70 disabled:cursor-not-allowed"
        />
      </div>

      {/* Checklist */}
      <div className="flex flex-col gap-1.5">
        {showChecklist ? (
          <>
            <div className="flex items-center justify-between">
              <label className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                Checklist
              </label>
              {!canEditChecklist && lockedReason && (
                <span className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground">
                  <Lock size={10} /> {lockedReason}
                </span>
              )}
            </div>
            <div
              className={`bg-card rounded-xl border border-border p-3 ${
                canEditChecklist ? "" : "opacity-70 pointer-events-none"
              }`}
            >
              {/* Keyed on the member: ChecklistTaskInput reads its value only on
                  mount, so without this it would keep showing the previously
                  selected member's items. */}
              <ChecklistTaskInput
                key={member.id}
                value={JSON.stringify(checklistItems)}
                onChange={(e) => onChange("checklist", e.target.value)}
                name="checklist"
              />
            </div>
          </>
        ) : (
          canEditChecklist && (
            <button
              type="button"
              onClick={() => onChange("showChecklist", true)}
              className="self-start flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground hover:text-foreground transition-all py-1.5 px-2.5 rounded-lg hover:bg-muted"
            >
              <span className="text-base leading-none">+</span> Add checklist
            </button>
          )
        )}
      </div>

      {children}
    </div>
  );
}
