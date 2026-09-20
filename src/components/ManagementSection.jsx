import { ClipboardList, Building2, Users } from "lucide-react";
import Dot from "./ui/Dot";
import Dropdown from "./ui/Dropdown";
import { FilterTrigger, FilterOptionList } from "./ui/FilterDropdown";
import { FieldBox } from "./FieldBox";

const ManagementSection = ({
  isEditing,
  isHr,
  isHead,
  formData,
  handlers,
  topologyData,
  taskLoggedByName,
  reportedToName,
}) => {
  const { handleDeptChange, handleSubDeptChange, handleAssigneeChange } =
    handlers;
  const { uniqueDepts, uniqueSubDepts, filteredEmployees } = topologyData;

  // Level 3 Access: Only HR can change Dept/Sub-Dept
  const canEditOrg = isHr;
  // Level 2 Access: HR and Heads can change the Assignee
  const canEditAssignee = isHr || isHead;

  return (
    <div className="grid grid-cols-2 gap-3 bg-muted/30 p-4 rounded-2xl border border-border">
      <div className="col-span-2 text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground mb-1 flex items-center gap-2">
        <Dot />
        Management Details
      </div>

      {/* 1. Department */}
      <FieldBox label="Department" isEditing={isEditing} noBorder={isEditing}>
        {isEditing ? (
          <Dropdown
            usePortal
            className="w-full"
            disabled={!canEditOrg}
            trigger={({ isOpen, disabled }) => (
              <FilterTrigger
                label={formData.department || "Select..."}
                isActive={!!formData.department}
                isOpen={isOpen}
                icon={Building2}
                disabled={disabled}
              />
            )}
          >
            {({ close }) => (
              <FilterOptionList
                options={uniqueDepts.map((d) => ({ value: d, label: d }))}
                value={formData.department}
                onChange={(val) => {
                  handleDeptChange({ target: { value: val } });
                  close();
                }}
                close={close}
              />
            )}
          </Dropdown>
        ) : (
          <p className="px-3 text-sm font-semibold text-foreground">
            {formData.department || "N/A"}
          </p>
        )}
      </FieldBox>

      {/* 2. Sub-Department */}
      <FieldBox
        label="Sub-Department"
        isEditing={isEditing}
        noBorder={isEditing}
      >
        {isEditing ? (
          <Dropdown
            usePortal
            className="w-full"
            disabled={!canEditOrg || !formData.department}
            trigger={({ isOpen, disabled }) => (
              <FilterTrigger
                label={formData.subDepartment || "Select..."}
                isActive={!!formData.subDepartment}
                isOpen={isOpen}
                icon={Building2}
                disabled={disabled}
              />
            )}
          >
            {({ close }) => (
              <FilterOptionList
                options={uniqueSubDepts.map((s) => ({ value: s, label: s }))}
                value={formData.subDepartment}
                onChange={(val) => {
                  handleSubDeptChange({ target: { value: val } });
                  close();
                }}
                close={close}
              />
            )}
          </Dropdown>
        ) : (
          <p className="px-3 text-sm font-semibold text-foreground">
            {formData.subDepartment || "N/A"}
          </p>
        )}
      </FieldBox>

      {/* 3. Assignee */}
      <div className="col-span-2">
        <FieldBox
          label="Employee (Assignee)"
          isEditing={isEditing}
          noBorder={isEditing}
        >
          {isEditing ? (
            <Dropdown
              usePortal
              className="w-full"
              disabled={!canEditAssignee || (isHr && !formData.department && !formData.subDepartment)}
              trigger={({ isOpen, disabled }) => (
                <FilterTrigger
                  label={
                    filteredEmployees.find((e) => e.id === formData.loggedById)
                      ?.name || "Select Employee..."
                  }
                  isActive={!!formData.loggedById}
                  isOpen={isOpen}
                  icon={Users}
                  disabled={disabled}
                />
              )}
            >
              {({ close }) => (
                <FilterOptionList
                  showSearch
                  options={filteredEmployees.map((emp) => ({
                    value: emp.id,
                    label: emp.name,
                  }))}
                  value={formData.loggedById}
                  onChange={(val) => {
                    handleAssigneeChange({ target: { value: val } });
                    close();
                  }}
                  close={close}
                />
              )}
            </Dropdown>
          ) : (
            <p className="px-3 text-sm font-bold text-foreground">
              {taskLoggedByName}
            </p>
          )}
        </FieldBox>
      </div>

      {/* 4. Reported To (Head) — Read-only display */}
      {!isEditing && reportedToName && (
        <div className="col-span-2 pt-2 border-t border-border mt-1">
          <FieldBox label="Reported To (Head)" isEditing={false}>
            <p className="px-3 text-sm font-bold text-violet-10 flex items-center gap-2">
              <ClipboardList size={14} className="text-violet-8" />
              {reportedToName}
            </p>
          </FieldBox>
        </div>
      )}
    </div>
  );
};

export default ManagementSection;
