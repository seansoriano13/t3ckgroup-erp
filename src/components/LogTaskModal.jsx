import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";

// Hooks
import { useLogTaskData } from "../hooks/useLogTaskData";
import { useLogTaskHandlers } from "../hooks/useLogTaskHandlers";

// Components
import LogTaskHeader from "./log-task/LogTaskHeader";
import LogTaskDetailsSection from "./log-task/LogTaskDetailsSection";
import LogTaskPropertyBar from "./log-task/LogTaskPropertyBar";
import LogTaskAssignmentBar from "./log-task/LogTaskAssignmentBar";
import LogTaskFooter from "./log-task/LogTaskFooter";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import PeoplePicker from "@/components/ui/PeoplePicker";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { FieldBox } from "@/components/ui/FieldBox";

// ═════════════════════════════════════════════════════════════
//  MODAL COMPONENT
// ═════════════════════════════════════════════════════════════
export default function LogTaskModal({ isOpen, onClose, mode = "normal", onSubmitOverride, initialData }) {
  const { user } = useAuth();

  // Issue #204 Part 2 — held here rather than in useLogTaskHandlers' formData
  // since it's specific to the automation path, and merged into the payload
  // only at submit rather than threaded through every non-automation caller.
  const [confirmMode, setConfirmMode] = useState(initialData?.confirmMode);
  const [decider, setDecider] = useState(initialData?.decider || []);
  useEffect(() => {
    if (!isOpen) return;
    setConfirmMode(initialData?.confirmMode);
    setDecider(initialData?.decider || []);
  }, [isOpen, initialData]);

  const titleRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const categoryRef = useRef(null);
  const priorityRef = useRef(null);
  const endTimeRef = useRef(null);
  const assignmentRef = useRef(null);

  // ── Data Hook ─────────────────────────────────────────────
  const { categories, employees, availableHeads, isLoadingData, roles } =
    useLogTaskData(isOpen, user);

  // ── Handlers & Form Hook ──────────────────────────────────
  const {
    formData,
    setFormData,
    selectedHead,
    setSelectedHead,
    committeeRole,
    setCommitteeRole,
    othersRemarks,
    setOthersRemarks,
    showChecklist,
    setShowChecklist,
    openPopover,
    setOpenPopover,
    createMore,
    setCreateMore,
    handleChange,
    handleTogglePopover,
    handleSubmit,
    handleClose,
    isSubmitting,
    hrDeptFilter,
    setHrDeptFilter,
    hrSubDeptFilter,
    setHrSubDeptFilter,
    isExpanded,
    setIsExpanded,
  } = useLogTaskHandlers({
    isOpen,
    onClose,
    user,
    categories,
    employees,
    availableHeads,
    roles,
    mode,
    onSubmitOverride: onSubmitOverride
      ? (payload) =>
          onSubmitOverride({
            ...payload,
            confirmMode,
            decider: confirmMode === "confirm" ? decider : undefined,
          })
      : onSubmitOverride,
    initialData,
  });

  // ── Auto-scroll Helper ────────────────────────────────────
  const scrollToElement = (ref, isSelect = false) => {
    if (ref.current) {
      setTimeout(() => {
        const el = ref.current;
        const popover = document.querySelector(".popover-enter");

        if (popover) {
          popover.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        } else {
          el.scrollIntoView({
            behavior: "smooth",
            block: isSelect ? "center" : "nearest",
          });
        }
      }, 150);
    }
  };

  const togglePopoverWithScroll = (name) => {
    handleTogglePopover(name);
    if (name === "category") scrollToElement(categoryRef);
    if (name === "priority") scrollToElement(priorityRef);
    if (name === "endTime") scrollToElement(endTimeRef);
  };

  // ── Effects ───────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => titleRef.current?.focus(), 150);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        document.getElementById("log-task-form")?.requestSubmit();
      }
      if (e.key === "Escape") {
        if (openPopover) setOpenPopover(null);
        else handleClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, openPopover, onClose, setOpenPopover, handleClose]);

  // ── Derived / Computed ────────────────────────────────────
  const selectedCategoryObj = categories.find(
    (c) => c.category_id === formData.categoryId,
  );
  const isCommittee = selectedCategoryObj?.description
    ?.toUpperCase()
    .includes("COMMITTEE");
  const isOthersGlobal =
    selectedCategoryObj?.category_id?.toUpperCase().includes("OTHERS") ||
    selectedCategoryObj?.description?.toUpperCase().includes("OTHERS");

  const { isHr } = roles;

  const uniqueDepts = [
    ...new Set(
      [
        ...categories.map((c) => c.department),
        ...employees.map((e) => e.department),
      ].filter(Boolean),
    ),
  ].sort();

  const uniqueSubDepts = [
    ...new Set(
      [
        ...categories
          .filter((c) => !hrDeptFilter || c.department === hrDeptFilter)
          .map((c) => c.sub_department),
        ...employees
          .filter((e) => !hrDeptFilter || e.department === hrDeptFilter)
          .map((e) => e.sub_department),
      ].filter(Boolean),
    ),
  ].sort();

  const filteredEmployees = employees
    .filter((emp) => {
      if (!isHr) return true;
      if (hrDeptFilter && emp.department !== hrDeptFilter) return false;
      if (hrSubDeptFilter && emp.sub_department !== hrSubDeptFilter)
        return false;
      return true;
    })
    .sort((a, b) => {
      if (a.id === user.id) return -1;
      if (b.id === user.id) return 1;
      return a.name.localeCompare(b.name);
    });

  const selectedEmployeeInfo = employees.find(
    (emp) => emp.id === formData.loggedById,
  ) || {
    department: user?.department || "N/A",
    sub_department: user?.sub_department || user?.subDepartment || "N/A",
  };

  const filteredCategories = categories.filter((cat) => {
    const catId = cat.category_id?.toUpperCase() || "";
    const desc = cat.description?.toUpperCase() || "";
    if (
      catId.includes("COMMITTEE") ||
      catId.includes("OTHERS") ||
      catId.includes("CHECKLIST") ||
      desc.includes("COMMITTEE") ||
      desc.includes("OTHERS") ||
      desc.includes("CHECKLIST") ||
      cat.sub_department === "ALL"
    )
      return true;
    if (isHr && hrSubDeptFilter) return cat.sub_department === hrSubDeptFilter;
    if (isHr && hrDeptFilter) return cat.department === hrDeptFilter;
    return cat.sub_department === selectedEmployeeInfo.sub_department;
  });


  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent
        showCloseButton={false}
        className={`p-0 gap-0 z-[70] shadow-[0_10px_40px_-10px_rgba(79,70,229,0.15)] flex flex-col transition-all duration-300 w-[680px] sm:max-w-none max-w-[95vw] rounded-2xl ${
          isExpanded
            ? "top-4 bottom-4 !translate-y-0 h-[calc(100vh-2rem)] max-h-none overflow-hidden"
            : "max-h-[90vh] overflow-hidden"
        }`}
      >
        <LogTaskHeader
          user={user}
          isExpanded={isExpanded}
          onToggleExpand={() => setIsExpanded(!isExpanded)}
          onClose={handleClose}
        />

        <form
          id="log-task-form"
          ref={scrollContainerRef}
          onSubmit={(e) => handleSubmit(e, { isCommittee, isOthersGlobal })}
          className={`flex-1 overflow-y-auto px-5 py-3 flex flex-col min-h-0 transition-all duration-300 ${openPopover ? "pb-[300px]" : "pb-6"}`}
        >
          <LogTaskDetailsSection
            formData={formData}
            handleChange={handleChange}
            titleRef={titleRef}
            selectedEmployeeInfo={selectedEmployeeInfo}
            showChecklist={showChecklist}
            onToggleChecklist={() => setShowChecklist(!showChecklist)}
            onChecklistChange={(value) =>
              setFormData((prev) => ({ ...prev, checklist: value }))
            }
            isExpanded={isExpanded}
            onAttachmentsChange={(urls) =>
              setFormData((prev) => ({ ...prev, attachments: urls }))
            }
            mode={mode}
          />

          {mode === "automation" && (
            <div className="mt-2 mb-1 rounded-lg border border-dashed border-mauve-7 px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">
                  Require confirmation before running
                </span>
                <Switch
                  checked={confirmMode === "confirm"}
                  onCheckedChange={(next) => setConfirmMode(next ? "confirm" : undefined)}
                />
              </div>
              {confirmMode === "confirm" && (
                <div className="mt-2 space-y-1">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                    Decider (defaults to the Deal Owner)
                  </span>
                  <PeoplePicker value={decider} onChange={setDecider} allowRoles placeholder="Add Decider" />
                </div>
              )}
            </div>
          )}

          <LogTaskPropertyBar
            formData={formData}
            setFormData={setFormData}
            categories={filteredCategories}
            isLoadingData={isLoadingData}
            categoryRef={categoryRef}
            priorityRef={priorityRef}
            endTimeRef={endTimeRef}
            setCommitteeRole={setCommitteeRole}
            setOthersRemarks={setOthersRemarks}
            openPopover={openPopover}
            onTogglePopover={togglePopoverWithScroll}
            mode={mode}
          />

          {/* Committee / Others details */}
          {(isCommittee || isOthersGlobal) && (
            <div className="py-3 animate-slide-down">
              {!isCommittee && (
                <span className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">
                  Others Details
                </span>
              )}

              {isCommittee && (
                <div className="bg-mauve-4/80 /40 p-4 rounded-xl border border-mauve-5/60 /50 mb-3">
                  <FieldBox bare label="SELECT COMMITTEE ROLE">
<div className="flex flex-wrap gap-2">
                    {["EVENT", "CREATIVE", "DEMO", "BAC", "ODOO", "OTHERS"].map(
                      (role) => (
                        <Button
                          key={role}
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            setCommitteeRole(role);
                          }}
                          variant="ghost" className={`h-auto px-4 py-2 rounded-full text-[11px] font-bold tracking-wider transition-all duration-200 border ${
                            committeeRole === role
                              ? "bg-primary text-primary-foreground border-primary dark:bg-primary dark:text-primary-foreground dark:border-primary shadow-md"
                              : "bg-card text-mauve-11 border-mauve-5 hover:border-mauve-5 hover:bg-mauve-2   dark:text-muted-foreground dark:hover:bg-muted shadow-sm"
                          }`}
                        >
                          {role}
                        </Button>
                      ),
                    )}
                  </div>
</FieldBox>
                </div>
              )}

              {(isOthersGlobal || committeeRole === "OTHERS") && (
                <div className="animate-slide-down">
                  {isCommittee && committeeRole === "OTHERS" && (
                    <span className="block text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">
                      Others Details
                    </span>
                  )}
                  <Textarea
                    placeholder="Specify details..."
                    value={othersRemarks}
                    onChange={(e) => setOthersRemarks(e.target.value)}
                    className="h-20 resize-none"
                  />
                </div>
              )}
            </div>
          )}

          <LogTaskAssignmentBar
            formData={formData}
            setFormData={setFormData}
            roles={roles}
            employees={employees}
            availableHeads={availableHeads}
            filteredEmployees={filteredEmployees}
            selectedHead={selectedHead}
            setSelectedHead={setSelectedHead}
            assignmentRef={assignmentRef}
            uniqueDepts={uniqueDepts}
            uniqueSubDepts={uniqueSubDepts}
            hrDeptFilter={hrDeptFilter}
            setHrDeptFilter={setHrDeptFilter}
            hrSubDeptFilter={hrSubDeptFilter}
            setHrSubDeptFilter={setHrSubDeptFilter}
            onScroll={scrollToElement}
            user={user}
            openPopover={openPopover}
            onTogglePopover={togglePopoverWithScroll}
            mode={mode}
          />
        </form>

        <LogTaskFooter
          createMore={createMore}
          setCreateMore={setCreateMore}
          isSubmitting={isSubmitting}
          onClose={handleClose}
        />
      </DialogContent>
    </Dialog>
  );
}
