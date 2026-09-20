import { AlertCircle, Tag } from "lucide-react";
import Dot from "./ui/Dot";
import { formatDate } from "../utils/formatDate";
import { extractOthersDetailsFromRemarks } from "../utils/taskFormatters";
import { FieldBox } from "./FieldBox";
import StatusBadge from "./StatusBadge";
import { TASK_STATUS } from "../constants/status";
import { Input } from "@/components/ui/input";
import { Clock } from "lucide-react";
import { CheckCircle2, ChevronDown } from "lucide-react";
import PriorityDropdown from "./dropdowns/PriorityDropdown";
import Dropdown from "./ui/Dropdown";
import { FilterTrigger, FilterOptionList } from "./ui/FilterDropdown";

const StandardDetailsSection = ({
  isEditing,
  isManagement,
  formData,
  handleChange,
  topologyData,
  task,
}) => {
  const { filteredCategories } = topologyData;
  const othersDetails = extractOthersDetailsFromRemarks(task?.remarks);
  const categoryDescription =
    filteredCategories?.find((c) => c.category_id === task.categoryId)
      ?.description || "Unknown Category";
  const categoryLabel = othersDetails || categoryDescription;



  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <FieldBox label="Task Category" isEditing={isEditing} noBorder={isEditing}>
          {isEditing ? (
            <div className="w-full flex flex-col">
              <Dropdown
                usePortal
                className="w-full"
                disabled={!formData.loggedById && isManagement}
                trigger={({ isOpen, disabled }) => (
                  <FilterTrigger
                    label={
                      formData.categoryId
                        ? `${formData.categoryId} - ${filteredCategories.find((c) => c.category_id === formData.categoryId)?.description || ""}`
                        : topologyData?.isLoadingTop
                          ? "Loading..."
                          : !formData.loggedById && isManagement
                            ? "Select Assignee First"
                            : "Select Category..."
                    }
                    isActive={!!formData.categoryId}
                    isOpen={isOpen}
                    icon={Tag}
                    disabled={disabled}
                  />
                )}
              >
                {({ close }) => (
                  <FilterOptionList
                    showSearch
                    options={filteredCategories.map((cat) => ({
                      value: cat.category_id,
                      label: `${cat.category_id} - ${cat.description}`,
                    }))}
                    value={formData.categoryId}
                    onChange={(val) => {
                      handleChange({ target: { name: "categoryId", value: val } });
                      close();
                    }}
                    close={close}
                  />
                )}
              </Dropdown>

              {filteredCategories.length === 0 &&
                !topologyData?.isLoadingTop &&
                formData.loggedById && (
                  <p className="text-[10px] text-destructive px-3 pb-2 font-bold leading-tight">
                    No categories mapped for this team.
                  </p>
                )}
            </div>
          ) : (
            <div className="mx-3 my-1.5 flex items-center">
              <span className="text-xs font-bold text-foreground bg-muted py-1.5 px-2.5 rounded-xl border border-border leading-relaxed inline-block">
                {task.categoryId}
                <span className="font-medium text-muted-foreground ml-1">
                  - {categoryLabel}
                </span>
              </span>
            </div>
          )}
        </FieldBox>
        <FieldBox label="Priority" isEditing={isEditing} noBorder={isEditing}>
          {isEditing ? (
            <PriorityDropdown
              value={formData.priority}
              onChange={(val) => handleChange({ target: { name: "priority", value: val } })}
              usePortal
              customTrigger={({ isOpen, currentPriority }) => (
                <div
                  className={`h-[40px] md:h-[46px] w-full flex items-center justify-between px-3 rounded-lg border transition-all cursor-pointer ${
                    isOpen
                      ? "ring-1 ring-mauve-4 bg-muted font-medium"
                      : "bg-card border-border hover:border-border/80"
                  }`}
                >
                  <div
                    className={`flex items-center gap-2 ${
                      currentPriority.value === "HIGH"
                        ? "text-destructive"
                        : currentPriority.value === "MEDIUM"
                          ? "text-amber-10"
                          : "text-muted-foreground"
                    }`}
                  >
                    <Dot size="w-2 h-2" color={currentPriority.dot} />
                    <span className="text-[13px] font-bold">{currentPriority.label}</span>
                  </div>
                  <ChevronDown size={14} className={`text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </div>
              )}
            />
          ) : (
            <div
              className={`px-3 text-sm font-bold flex items-center gap-2 ${task.priority === "HIGH" ? "text-destructive" : task.priority === "MEDIUM" ? "text-amber-10" : "text-muted-foreground"}`}
            >
              <Dot
                size="w-2 h-2"
                color={
                  task.priority === "HIGH"
                    ? "bg-destructive"
                    : task.priority === "MEDIUM"
                      ? "bg-warning"
                      : "bg-mauve-6"
                }
                className={
                  task.priority === "HIGH"
                    ? "shadow-[0_0_8px_rgba(239,68,68,0.4)]"
                    : task.priority === "MEDIUM"
                      ? "shadow-[0_0_8px_rgba(245,158,11,0.4)]"
                      : ""
                }
              />
              {task.priority || "LOW"}
            </div>
          )}
        </FieldBox>
      </div>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <FieldBox label="Status" isEditing={false}>
          <div className="px-3">
            <StatusBadge status={task.status} />
          </div>
        </FieldBox>
        {/* {!isEditing && (
          <FieldBox label="Created At" isEditing={false}>
            <p className="px-3 text-sm font-semibold text-muted-foreground">
              {formatDate(task.createdAt)}
            </p>
          </FieldBox>
        )} */}
        {!isEditing && (
          <FieldBox label="HR Verification Status" isEditing={false}>
            <div className="px-3 flex items-center">
              {task.status !== TASK_STATUS.COMPLETE ? (
                <span className="text-sm font-semibold text-muted-foreground">
                  N/A (Awaiting Manager)
                </span>
              ) : task.hrVerified ? (
                <span className="text-sm font-bold text-green-10 flex items-center gap-1.5">
                  <CheckCircle2 size={16} /> Verified
                </span>
              ) : (
                <span className="text-sm font-bold text-amber-10 flex items-center gap-1.5">
                  <Clock size={16} /> Pending HR Audit
                </span>
              )}
            </div>
          </FieldBox>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <FieldBox label="Start Time" isEditing={isEditing} noBorder={isEditing}>
          {isEditing ? (
            <Input
              disabled
              type="datetime-local"
              name="startAt"
              value={formData.startAt}
              onChange={handleChange}
              className="w-full h-11 pointer-events-none opacity-50"
            />
          ) : (
            <p className="px-3 text-sm font-semibold text-foreground">
              {formatDate(task.startAt)}
            </p>
          )}
        </FieldBox>
        <FieldBox label="End Time" isEditing={isEditing} noBorder={isEditing}>
          {isEditing ? (
            <Input
              type="datetime-local"
              name="endAt"
              value={formData.endAt}
              onChange={handleChange}
              className="w-full h-11"
            />
          ) : (
            <p className="px-3 text-sm font-semibold text-foreground">
              {formatDate(task.endAt)}
            </p>
          )}
        </FieldBox>
      </div>
    </>
  );
};

export default StandardDetailsSection;
