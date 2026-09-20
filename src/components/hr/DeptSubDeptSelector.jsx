import { useState } from "react";
import { Building2, Info } from "lucide-react";
import Dropdown from "../ui/Dropdown";
import { FilterTrigger, FilterOptionList } from "../ui/FilterDropdown";

/**
 * Reusable selection component for Department and Sub-Department with manual entry fallback.
 */

export default function DeptSubDeptSelector({
  department,
  subDepartment,
  onDepartmentChange,
  onSubDepartmentChange,
  uniqueDepts = [],
  uniqueSubDepts = [],
}) {
  const [isNewDept, setIsNewDept] = useState(false);
  const [isNewSubDept, setIsNewSubDept] = useState(false);

  const handleDeptSelect = (val) => {
    onDepartmentChange(val);
    onSubDepartmentChange(""); // Clear sub-dept when dept changes
    setIsNewDept(false);
  };

  const handleSubDeptSelect = (val) => {
    onSubDepartmentChange(val);
    setIsNewSubDept(false);
  };

  const enableManualDept = () => {
    setIsNewDept(true);
    onDepartmentChange("");
    onSubDepartmentChange("");
  };

  const enableManualSubDept = () => {
    setIsNewSubDept(true);
    onSubDepartmentChange("");
  };

  const cancelManual = () => {
    setIsNewDept(false);
    setIsNewSubDept(false);
    onDepartmentChange("");
    onSubDepartmentChange("");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 py-4 border-t border-b border-border/50">
        {/* Department Selection */}
        <Dropdown
          usePortal={true}
          placement="top-start"
          trigger={({ isOpen }) => (
            <FilterTrigger
              label={department || "Set Department"}
              isActive={!!department}
              isOpen={isOpen}
              icon={Building2}
            />
          )}
        >
          {({ close }) => (
            <div className="p-1">
              <div className="px-3 py-2 border-b border-border mb-1">
                <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                  Select Department
                </p>
              </div>
              <FilterOptionList
                options={uniqueDepts.map((d) => ({ label: d, value: d }))}
                value={department}
                onChange={(val) => {
                  handleDeptSelect(val);
                  close();
                }}
                close={close}
              />
              <button
                type="button"
                onClick={() => {
                  enableManualDept();
                  close();
                }}
                className="w-full text-left px-3 py-2 rounded-md text-[11px] font-bold text-mauve-10 hover:bg-mauve-2 transition-colors uppercase tracking-wider"
              >
                + Add New Department
              </button>
            </div>
          )}
        </Dropdown>

        {/* Sub-Department Selection */}
        <Dropdown
          disabled={!department}
          usePortal={true}
          placement="top-start"
          trigger={({ isOpen, disabled }) => (
            <FilterTrigger
              label={subDepartment || "Set Sub-Dept"}
              isActive={!!subDepartment}
              isOpen={isOpen}
              icon={Building2}
              disabled={disabled}
            />
          )}
        >
          {({ close }) => (
            <div className="p-1">
              <div className="px-3 py-2 border-b border-border mb-1">
                <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest">
                  Select Sub-Dept
                </p>
              </div>
              <FilterOptionList
                options={[
                  { label: "None", value: "" },
                  ...uniqueSubDepts.map((s) => ({ label: s, value: s })),
                ]}
                value={subDepartment}
                onChange={(val) => {
                  handleSubDeptSelect(val);
                  close();
                }}
                close={close}
              />
              <button
                type="button"
                onClick={() => {
                  enableManualSubDept();
                  close();
                }}
                className="w-full text-left px-3 py-2 rounded-md text-[11px] font-bold text-mauve-10 hover:bg-mauve-2 transition-colors uppercase tracking-wider"
              >
                + Add New Sub-Dept
              </button>
            </div>
          )}
        </Dropdown>
      </div>

      {/* Managed Mode Inputs (Fallback) */}
      {(isNewDept || isNewSubDept) && (
        <div className="bg-mauve-2 border border-mauve-3 rounded-2xl p-4 space-y-3 animate-in slide-in-from-top-2">
          <div className="flex items-center gap-2 mb-1">
            <Info size={14} className="text-mauve-10" />
            <p className="text-[11px] font-black text-foreground uppercase tracking-widest">
              Manual Entry Mode
            </p>
          </div>
          {isNewDept && (
            <div>
              <label className="text-[9px] font-bold text-foreground/60 uppercase tracking-wider mb-1 block">
                New Department
              </label>
              <input
                required
                type="text"
                autoFocus
                placeholder="e.g. LOGISTICS"
                value={department}
                onChange={(e) =>
                  onDepartmentChange(e.target.value.toUpperCase())
                }
                className="w-full bg-card border border-mauve-5 rounded-xl px-3 py-2 text-xs outline-none focus:border-mauve-8 transition-all font-bold"
              />
            </div>
          )}
          {isNewSubDept && (
            <div>
              <label className="text-[9px] font-bold text-foreground/60 uppercase tracking-wider mb-1 block">
                New Sub-Department
              </label>
              <input
                required
                type="text"
                autoFocus
                placeholder="e.g. WAREHOUSE"
                value={subDepartment}
                onChange={(e) =>
                  onSubDepartmentChange(e.target.value.toUpperCase())
                }
                className="w-full bg-card border border-mauve-5 rounded-xl px-3 py-2 text-xs outline-none focus:border-mauve-8 transition-all font-bold"
              />
            </div>
          )}
          <button
            type="button"
            onClick={cancelManual}
            className="text-[10px] font-bold text-mauve-10 hover:underline"
          >
            Cancel manual entry
          </button>
        </div>
      )}
    </div>
  );
}
