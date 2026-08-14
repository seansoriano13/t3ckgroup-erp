import { useState, useMemo, useEffect, useRef } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Maximize2,
  X,
  ChevronDown,
  Check,
  Plus,
  Trash2,
  Calendar,
  Settings2,
  Users,
} from "lucide-react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import toast from "react-hot-toast";
import ChecklistTaskInput from "../../../components/ChecklistTaskInput";
import { Button } from "@/components/ui/button";
import Dropdown from "../../../components/ui/Dropdown";
import { FilterTrigger, FilterOptionList } from "../../../components/ui/FilterDropdown";
import Spinner from "@/components/ui/Spinner";
import { useQuery } from "@tanstack/react-query";
import { groupRoleService } from "../../../services/groupRoleService";
import GroupRoleManagerModal from "./GroupRoleManagerModal";

export default function CreateGroupTaskModal({
  isOpen,
  onClose,
  user,
  employees,
  onSubmit,
  isSubmitting,
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isRoleManagerOpen, setIsRoleManagerOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState(null);
  const [members, setMembers] = useState([
    {
      id: Date.now(),
      employeeId: null,
      taskDescription: "",
      descriptionType: "description",
      role: "",
      customRole: "",
      isRemoving: false,
    },
  ]);

  const titleRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      setTitle("");
      setDescription("");
      setDueDate(null);
      setMembers([
        {
          id: Date.now(),
          employeeId: null,
          taskDescription: "",
          descriptionType: "description",
          role: "",
          customRole: "",
          isRemoving: false,
        },
      ]);
      setTimeout(() => titleRef.current?.focus(), 150);
    }
  }, [isOpen]);

  const employeeOptions = useMemo(() => {
    return employees
      .filter((e) => !e.is_super_admin)
      .map((e) => ({ value: e.id, label: e.name, department: e.department }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [employees]);

  const { data: roles = [], isLoading: isRolesLoading } = useQuery({
    queryKey: ["groupRoles"],
    queryFn: groupRoleService.getRoles,
    enabled: isOpen,
  });

  const handleAddMember = () => {
    setMembers([
      ...members,
      {
        id: Date.now(),
        employeeId: null,
        taskDescription: "",
        descriptionType: "description",
        role: "",
        customRole: "",
        isRemoving: false,
      },
    ]);
  };

  const handleRemoveMember = (id) => {
    setMembers(
      members.map((m) => (m.id === id ? { ...m, isRemoving: true } : m)),
    );
    setTimeout(() => {
      setMembers((prev) => prev.filter((m) => m.id !== id));
    }, 300);
  };

  const handleMemberChange = (id, field, value) => {
    setMembers(
      members.map((m) => (m.id === id ? { ...m, [field]: value } : m)),
    );
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error("Title is required.");
      return;
    }

    const validMembers = members.filter(
      (m) => m.employeeId && m.taskDescription.trim(),
    );
    if (validMembers.length === 0) {
      toast.error("Add at least one valid member with a task description.");
      return;
    }

    onSubmit({
      title,
      description,
      dueDate,
      createdBy: user.id,
      members: validMembers,
    });
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className={`p-0 gap-0 z-[70] shadow-[0_10px_40px_-10px_rgba(79,70,229,0.15)] flex flex-col transition-all duration-300 w-[960px] sm:max-w-none max-w-[95vw] rounded-2xl ${
          isExpanded
            ? "top-4 bottom-4 !translate-y-0 h-[calc(100vh-2rem)] max-h-none overflow-hidden"
            : "max-h-[90vh] overflow-hidden"
        }`}
      >
        {/* HEADER */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2 border-b border-mauve-3/40 shrink-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="w-[18px] h-[18px] rounded flex items-center justify-center bg-primary text-primary-foreground font-bold text-[9px] shrink-0">
              {user?.department?.charAt(0)?.toUpperCase() || "C"}
            </div>
            <ChevronDown size={11} className="text-mauve-6 rotate-[-90deg]" />
            <span className="font-medium text-muted-foreground/80">
              New Group Task
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
              title={isExpanded ? "Collapse" : "Expand"}
            >
              <Maximize2 size={14} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* CONTENT */}
        <form
          id="create-group-form"
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto px-6 py-5 flex flex-col min-h-0 custom-scrollbar"
        >
          <div className="animate-content-in stagger-1">
            <input
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Group Task Title"
              className="w-full text-xl font-semibold text-foreground bg-transparent outline-none placeholder:text-mauve-6 border-none pb-1 mb-3"
              autoComplete="off"
            />
          </div>

          <div className="mb-5 animate-content-in stagger-2">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Provide an overview of the group task objective..."
              className={`w-full bg-transparent border-none outline-none transition-all resize-y text-[13px] text-foreground placeholder:text-mauve-6 ${
                isExpanded ? "h-32" : "h-16"
              }`}
            />
          </div>

          <div className="flex justify-center mb-8 pb-5 border-b border-border/50 animate-content-in stagger-3 relative z-10">
            <div className="flex flex-col items-center">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5 px-1">
                Target Due Date
              </span>
              <div className="relative">
                <DatePicker
                  selected={dueDate}
                  onChange={(date) => setDueDate(date)}
                  showTimeSelect
                  timeIntervals={15}
                  dateFormat="MMMM d, yyyy h:mm aa"
                  placeholderText="Select optional due date & time"
                  className="bg-muted border border-border rounded-lg pl-8 pr-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 transition-colors w-64 text-center"
                />
                <Calendar
                  size={13}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
              </div>
            </div>
          </div>

          <div className="animate-content-in stagger-4 flex-1">
            <div className="mb-4">
              <label className="block text-xs font-bold text-muted-foreground uppercase tracking-widest mb-1">
                Assign Members & Tasks <span className="text-destructive">*</span>
              </label>
              <p className="text-[13px] text-muted-foreground">
                Assign specific responsibilities to each team member by adding
                cards below.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {members.map((member, index) => (
                <div
                  key={member.id}
                  className={`p-4 border border-border rounded-xl bg-muted/20 relative group flex flex-col gap-4 shadow-sm hover:shadow-md transition-all duration-300 transform origin-center ${
                    member.isRemoving
                      ? "opacity-0 scale-95"
                      : "opacity-100 scale-100"
                  }`}
                >
                  {/* Assignee */}
                  <div className="flex flex-col gap-1.5 relative z-20">
                    <label className="block text-[10px] font-bold text-muted-foreground uppercase">
                      Assignee
                    </label>
                    <Dropdown
                      usePortal
                      className="w-full"
                      trigger={({ isOpen }) => (
                        <FilterTrigger
                          label={
                            employeeOptions.find((o) => o.value === member.employeeId)
                              ?.label || "Select Employee..."
                          }
                          isActive={!!member.employeeId}
                          isOpen={isOpen}
                          icon={Users}
                        />
                      )}
                    >
                      {({ close }) => (
                        <FilterOptionList
                          options={employeeOptions}
                          value={member.employeeId}
                          onChange={(val) => {
                            handleMemberChange(member.id, "employeeId", val);
                            close();
                          }}
                          close={close}
                        />
                      )}
                    </Dropdown>
                  </div>

                  {/* Role */}
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <label className="block text-[10px] font-bold text-muted-foreground uppercase">
                        Role (Optional)
                      </label>
                      <button
                        type="button"
                        onClick={() => setIsRoleManagerOpen(true)}
                        className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted transition-colors flex items-center gap-1 text-[9px] font-bold uppercase"
                        title="Manage Roles"
                      >
                        <Settings2 size={11} /> Manage
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {isRolesLoading ? (
                        <div className="text-[10px] text-muted-foreground animate-pulse">Loading roles...</div>
                      ) : (
                        roles.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() =>
                              handleMemberChange(
                                member.id,
                                "role",
                                member.role === r.role_name ? "" : r.role_name,
                              )
                            }
                            className={`px-3 py-1.5 rounded-full text-[10px] font-bold tracking-wider transition-all ${
                              member.role === r.role_name
                                ? "bg-primary text-primary-foreground shadow-sm scale-105 border border-primary"
                                : "bg-card text-foreground border border-border hover:border-mauve-5 hover:text-foreground shadow-sm"
                            }`}
                          >
                            {r.role_name}
                          </button>
                        ))
                      )}
                    </div>
                    {member.role === "OTHERS" && (
                      <div className="animate-slide-down mt-1">
                        <input
                          type="text"
                          value={member.customRole}
                          onChange={(e) =>
                            handleMemberChange(
                              member.id,
                              "customRole",
                              e.target.value,
                            )
                          }
                          placeholder="Specify custom role..."
                          className="w-full bg-card border border-border rounded-lg px-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 transition-colors"
                        />
                      </div>
                    )}
                  </div>

                  {/* Task Description */}
                  <div className="flex-1 flex flex-col gap-2">
                    <div className="flex justify-between items-end">
                      <label className="block text-[10px] font-bold text-muted-foreground uppercase">
                        Specific Task
                      </label>
                      {/* Toggle tabs */}
                      <div className="flex gap-0.5 bg-muted rounded border border-border p-0.5 w-fit">
                        <button
                          type="button"
                          onClick={() =>
                            handleMemberChange(
                              member.id,
                              "descriptionType",
                              "description",
                            )
                          }
                          className={`text-[9px] px-2 py-0.5 rounded font-bold transition-all ${
                            member.descriptionType === "description" ||
                            !member.descriptionType
                              ? "bg-card text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-muted-foreground/80"
                          }`}
                        >
                          Text
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleMemberChange(
                              member.id,
                              "descriptionType",
                              "checklist",
                            )
                          }
                          className={`text-[9px] px-2 py-0.5 rounded font-bold transition-all ${
                            member.descriptionType === "checklist"
                              ? "bg-card text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-muted-foreground/80"
                          }`}
                        >
                          Checklist
                        </button>
                      </div>
                    </div>

                    {member.descriptionType === "checklist" ? (
                      <div className="bg-card rounded-lg border border-border p-1.5 flex-1 min-h-[96px]">
                        <ChecklistTaskInput
                          value={member.taskDescription}
                          onChange={(e) =>
                            handleMemberChange(
                              member.id,
                              "taskDescription",
                              e.target.value,
                            )
                          }
                        />
                      </div>
                    ) : (
                      <textarea
                        value={
                          typeof member.taskDescription === "string" &&
                          (member.taskDescription.trim().startsWith("[") ||
                            member.taskDescription.trim().startsWith("{"))
                            ? ""
                            : member.taskDescription
                        }
                        onChange={(e) =>
                          handleMemberChange(
                            member.id,
                            "taskDescription",
                            e.target.value,
                          )
                        }
                        placeholder="What exactly are they responsible for?"
                        className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-[13px] text-foreground outline-none focus:border-primary/50 transition-colors h-24 resize-none flex-1"
                      />
                    )}
                  </div>

                  {members.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveMember(member.id)}
                      className="absolute -top-3 -right-3 bg-card border border-border text-destructive rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-all hover:bg-destructive/5 hover:text-destructive shadow-sm z-30"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}

              <button
                type="button"
                onClick={handleAddMember}
                className="flex items-center justify-center gap-2 w-full h-[220px] border-2 border-dashed border-primary/20 rounded-xl text-primary font-bold text-xs hover:bg-primary/5 hover:border-primary/40 transition-colors"
              >
                <Plus size={18} /> Add Another Member
              </button>
            </div>
          </div>
        </form>

        {/* FOOTER */}
        <div className="px-5 py-4 border-t border-border bg-muted/30 flex items-center justify-between shrink-0">
          <div className="hidden sm:flex items-center gap-3 text-[10px] text-muted-foreground font-medium">
            <div className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-muted/80 border border-border rounded text-muted-foreground font-sans text-[9px]">
                Esc
              </kbd>
              <span>to cancel</span>
            </div>
          </div>

          <div className="flex items-center gap-2.5 ml-auto">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-[13px] font-bold text-muted-foreground/80 hover:text-foreground h-9 rounded-xl px-4"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="create-group-form"
              disabled={isSubmitting}
              className="h-9 px-6 rounded-xl shadow-lg shadow-primary/20"
            >
              {isSubmitting ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  <span>Creating…</span>
                </>
              ) : (
                <>
                  <Check size={16} strokeWidth={3} className="mr-1.5" />
                  <span>Create Group Task</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
      </Dialog>
      <GroupRoleManagerModal
        isOpen={isRoleManagerOpen}
        onClose={() => setIsRoleManagerOpen(false)}
      />
    </>
  );
}
