import { Users, ClipboardList, Building2 } from "lucide-react"
import Dropdown from "../ui/Dropdown"
import { FilterTrigger, FilterOptionList } from "../ui/FilterDropdown"
import { FieldBox } from "../ui/FieldBox"

export default function LogTaskAssignmentBar({
  formData,
  setFormData,
  roles,
  // employees,
  availableHeads,
  hrDeptFilter,
  setHrDeptFilter,
  hrSubDeptFilter,
  setHrSubDeptFilter,
  uniqueDepts,
  uniqueSubDepts,
  filteredEmployees,
  selectedHead,
  setSelectedHead,
  assignmentRef,
  // onScroll,
  user,
  openPopover,
  onTogglePopover,
  mode,
}) {
  const { isHr, isHead } = roles // isSuperAdmin
  // An automation task has no "self" to log it for — the assignee is a flow
  // design choice for whoever edits the Sales Flow (already gated by
  // stageActionService's own Super Admin check), not something to further
  // gate behind the editor's own HR/Head role the way logging a task for
  // yourself is.
  const canAssignOthers = isHr || isHead || mode === "automation"

  return (
    <div
      className="flex flex-col gap-4 py-4 border-t border-mauve-3/40 animate-content-in stagger-4 relative z-10"
      ref={assignmentRef}
    >
      {/* ORGANIZATION SECTION (HR only) */}
      {isHr && (
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground/80 uppercase tracking-widest pl-1">
            <Users size={12} /> Assignment
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <FieldBox label="Dept" className="pl-1" />
              <Dropdown
                usePortal
                isOpen={openPopover === "hrDept"}
                onToggle={() => onTogglePopover("hrDept")}
                onClose={() => onTogglePopover(null)}
                className="w-full"
                trigger={({ isOpen }) => (
                  <FilterTrigger
                    label={hrDeptFilter || "All"}
                    isActive={!!hrDeptFilter}
                    isOpen={isOpen}
                    icon={Building2}
                  />
                )}
              >
                {({ close }) => (
                  <FilterOptionList
                    options={uniqueDepts.map((d) => ({ value: d, label: d }))}
                    value={hrDeptFilter}
                    onChange={(val) => {
                      setHrDeptFilter(val)
                      setHrSubDeptFilter("")
                      setFormData((p) => ({ ...p, loggedById: "" }))
                      close()
                    }}
                    close={close}
                  />
                )}
              </Dropdown>
            </div>
            <div className="space-y-1.5">
              <FieldBox label="Sub-Dept" className="pl-1" />
              <Dropdown
                usePortal
                isOpen={openPopover === "hrSubDept"}
                onToggle={() => onTogglePopover("hrSubDept")}
                onClose={() => onTogglePopover(null)}
                className="w-full"
                disabled={!hrDeptFilter}
                trigger={({ isOpen, disabled }) => (
                  <FilterTrigger
                    label={hrSubDeptFilter || "All"}
                    isActive={!!hrSubDeptFilter}
                    isOpen={isOpen}
                    icon={Building2}
                    disabled={disabled}
                  />
                )}
              >
                {({ close }) => (
                  <FilterOptionList
                    options={uniqueSubDepts.map((sd) => ({
                      value: sd,
                      label: sd,
                    }))}
                    value={hrSubDeptFilter}
                    onChange={(val) => {
                      setHrSubDeptFilter(val)
                      setFormData((p) => ({ ...p, loggedById: "" }))
                      close()
                    }}
                    close={close}
                  />
                )}
              </Dropdown>
            </div>
          </div>
        </div>
      )}

      {/* ASSIGNEE SECTION (HR/Head only) */}
      {canAssignOthers && (
        <div className="space-y-1.5">
          {!isHr && (
            <FieldBox label={<><Users size={12} /> Assign To</>} className="pl-1" />
          )}
          <Dropdown
            usePortal
            isOpen={openPopover === "assignee"}
            onToggle={() => onTogglePopover("assignee")}
            onClose={() => onTogglePopover(null)}
            className="w-full"
            trigger={({ isOpen }) => (
              <FilterTrigger
                label={
                  filteredEmployees.find(
                    (emp) => emp.id === formData.loggedById,
                  )
                    ? formData.loggedById === user.id
                      ? "Myself"
                      : filteredEmployees.find(
                          (emp) => emp.id === formData.loggedById,
                        ).name
                    : "Search assignee..."
                }
                isActive={!!formData.loggedById}
                isOpen={isOpen}
                icon={Users}
              />
            )}
          >
            {({ close }) => (
              <FilterOptionList
                showSearch
                options={filteredEmployees.map((emp) => ({
                  value: emp.id,
                  label: emp.id === user.id ? "Myself" : emp.name,
                }))}
                value={formData.loggedById}
                onChange={(val) => {
                  setFormData((p) => ({ ...p, loggedById: val }))
                  close()
                }}
                close={close}
              />
            )}
          </Dropdown>
        </div>
      )}

      {/* REPORTED TO SECTION */}
      <div className="space-y-1.5 pt-1">
        <FieldBox label={<><ClipboardList size={12} /> Report To (Head)</>} className="pl-1" />
        <Dropdown
          usePortal
          isOpen={openPopover === "reportedTo"}
          onToggle={() => onTogglePopover("reportedTo")}
          onClose={() => onTogglePopover(null)}
          className="w-full"
          trigger={({ isOpen }) => (
            <FilterTrigger
              label={
                availableHeads.find((h) => h.id === selectedHead)?.name ||
                "Select manager/head..."
              }
              isActive={!!selectedHead}
              isOpen={isOpen}
              icon={ClipboardList}
            />
          )}
        >
          {({ close }) => (
            <FilterOptionList
              showSearch
              options={availableHeads.map((h) => ({
                value: h.id,
                label: h.name,
              }))}
              value={selectedHead}
              onChange={(val) => {
                setSelectedHead(val)
                close()
              }}
              close={close}
            />
          )}
        </Dropdown>
      </div>
    </div>
  )
}
