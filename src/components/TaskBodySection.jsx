import { FolderKanban, Receipt, Briefcase } from "lucide-react"
import Dot from "./ui/Dot"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import ChecklistTaskInput from "./ChecklistTaskInput"
import ChecklistTaskRenderer from "./ChecklistTaskRenderer"
import HighlightText from "./HighlightText"
import ImageAttachment from "./ImageAttachment"
import { useProjectTitles } from "../hooks/useProjectTitles"

export default function TaskBodySection({
  isEditing,
  formData,
  handleChange,
  showChecklist,
  setShowChecklist,
  hasChecklist,
  isOthersGlobal,
  taskDept,
  isOwner,
  canEdit,
  searchTerm,
  setFormData,
  executeUpdate,
  task,
  user,
}) {
  const projectTitles = useProjectTitles(task?.loggedById || task?.logged_by || user?.id, isEditing);

  return (
    <>
      {/* --- PROJECT / CAMPAIGN TITLE --- */}
      {(isEditing || formData.projectTitle) && (
        <div className="flex flex-col gap-1.5 pt-2">
          <label className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider pl-1">
            <FolderKanban size={12} /> Project / Campaign Title
            {isEditing && (
              <span className="font-normal text-muted-foreground normal-case tracking-normal">
                (optional)
              </span>
            )}
          </label>
          {isEditing ? (
            <div className="relative">
              <Input
                type="text"
                name="projectTitle"
                value={formData.projectTitle}
                onChange={handleChange}
                placeholder="e.g. Q2 Brand Awareness Campaign"
                className="h-11 shadow-sm"
                autoComplete="on"
                list="project-titles-list"
              />
              <datalist id="project-titles-list">
                {projectTitles.map((title) => (
                  <option key={title} value={title} />
                ))}
              </datalist>
            </div>
          ) : (
            <div className="bg-muted px-4 py-3 rounded-xl border border-border/50 text-sm font-bold text-violet-10 flex items-center gap-2 shadow-sm">
              <FolderKanban size={14} />
              {formData.projectTitle}
            </div>
          )}
        </div>
      )}

      {/* --- OPPORTUNITY LINK --- */}
      {task?.opportunity && (
        <div className="flex flex-col gap-1.5 pt-2">
          <label className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider pl-1">
            <Briefcase size={12} /> Sales Opportunity
          </label>
          <div
            onClick={() => window.dispatchEvent(new CustomEvent("OPEN_ENTITY_DETAILS", { detail: { id: task.opportunityId, type: "OPPORTUNITY" } }))}
            className="bg-primary/10 px-4 py-3 rounded-xl border border-primary/20 text-sm font-bold text-primary flex items-center gap-2 shadow-sm cursor-pointer hover:bg-primary/20 transition-colors"
          >
            <Briefcase size={14} />
            {task.opportunity.sales_reference || task.opportunity.client_name}
          </div>
        </div>
      )}

      {/* --- PAYMENT VOUCHER --- */}
      {((isEditing && taskDept?.toUpperCase() === "ADMIN") ||
        formData.paymentVoucher) && (
        <div className="flex flex-col gap-1.5 pt-2">
          <label className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider pl-1">
            <Receipt size={12} /> Payment Voucher
            {isEditing && (
              <span className="font-normal text-muted-foreground normal-case tracking-normal">
                (optional)
              </span>
            )}
          </label>
          {isEditing ? (
            <Input
              type="text"
              name="paymentVoucher"
              value={formData.paymentVoucher || ""}
              onChange={handleChange}
              placeholder="e.g. PV-2026-001"
              className="h-11 shadow-sm"
            />
          ) : (
            <div className="bg-muted px-4 py-3 rounded-xl border border-border/50 text-sm font-bold text-foreground flex items-center gap-2 shadow-sm">
              <Receipt size={14} />
              {formData.paymentVoucher}
            </div>
          )}
        </div>
      )}

      {/* --- OTHERS DETAILS --- */}
      {isEditing && isOthersGlobal && (
        <div className="flex flex-col gap-1.5 pt-2 animate-slide-down">
          <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider pl-1">
            Others Details
          </label>
          <Textarea
            name="remarks"
            value={formData.remarks || ""}
            onChange={handleChange}
            placeholder="Specify details..."
            className="w-full bg-card border border-border text-foreground rounded-xl p-3 outline-none transition-all h-20 resize-none text-[13px] shadow-sm"
          />
        </div>
      )}

      {/* --- DESCRIPTION & CHECKLIST --- */}
      <div className="flex flex-col gap-1.5 pt-2">
        {isEditing ? (
          <div className="flex flex-col gap-4">
            {/* Description is always visible in edit mode */}
            <div>
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider pl-1 block mb-1">
                Description
              </label>
              <Textarea
                name="taskDescription"
                value={formData.taskDescription || ""}
                onChange={handleChange}
                className="w-full bg-card border border-border text-foreground rounded-xl p-4 outline-none transition-all h-32 resize-none text-[14px] shadow-sm"
              />
            </div>

            {/* Checklist is collapsible in edit mode */}
            <div>
              {showChecklist ? (
                <div className="animate-slide-down">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider pl-1">
                      Checklist
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowChecklist(false)}
                      className="text-[10px] font-bold text-muted-foreground hover:text-foreground transition-colors px-2 py-0.5 rounded hover:bg-muted"
                    >
                      Hide
                    </button>
                  </div>
                  <div className="bg-card rounded-xl border border-border p-4 shadow-sm">
                    <ChecklistTaskInput
                      value={formData.checklist ? (typeof formData.checklist === "string" ? formData.checklist : JSON.stringify(formData.checklist)) : ""}
                      onChange={(e) =>
                        setFormData((prev) => ({
                          ...prev,
                          checklist: e.target.value,
                        }))
                      }
                      name="checklist"
                    />
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowChecklist(true)}
                  className="flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground hover:text-foreground transition-all py-1.5 px-2.5 rounded-lg hover:bg-muted"
                >
                  <span className="text-base leading-none">+</span> Add checklist
                </button>
              )}
            </div>
          </div>
        ) : (
          /* VIEW MODE */
          <div className="flex flex-col gap-6">
            {/* Show description if it exists */}
            {formData.taskDescription?.trim() && (
              <div>
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em] pl-1 flex items-center gap-2 mb-2">
                  <Dot />
                  Description
                </label>
                <div className="bg-muted/30 p-6 rounded-2xl border border-border text-foreground leading-relaxed text-[15px] whitespace-pre-wrap shadow-sm">
                  <HighlightText text={formData.taskDescription} search={searchTerm} />
                </div>
              </div>
            )}

            {/* Show checklist if it exists */}
            {hasChecklist && (
              <div>
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em] pl-1 flex items-center gap-2 mb-2">
                  <Dot />
                  Checklist
                </label>
                <ChecklistTaskRenderer
                  description={formData.checklist}
                  isOwner={isOwner}
                  disabled={!canEdit || !isOwner}
                  searchTerm={searchTerm}
                  onInlineCheck={(newChecklist) => {
                    setFormData((prev) => ({
                      ...prev,
                      checklist: newChecklist,
                    }))
                    executeUpdate(
                      {
                        id: task.id,
                        checklist: newChecklist,
                        editedBy: user.id,
                      },
                      true,
                    )
                  }}
                />
              </div>
            )}
            
            {/* Fallback if both are completely empty */}
            {!formData.taskDescription?.trim() && !hasChecklist && (
               <div className="text-sm text-muted-foreground italic px-4 py-2">
                 No description or checklist provided.
               </div>
            )}
          </div>
        )}
      </div>

      {/* --- ATTACHMENTS (all tasks, owner only) --- */}
      <div className="flex flex-col gap-1.5 pt-2 border-t border-border mt-2">
        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider pl-1">
          Attachments
        </label>
        <ImageAttachment
          taskId={task.id}
          userId={user.id}
          attachments={formData.attachments || []}
          onChange={(newAttachments) => {
            setFormData({ ...formData, attachments: newAttachments })
            executeUpdate(
              {
                id: task.id,
                attachments: newAttachments,
                editedBy: user.id,
              },
              true,
            )
          }}
          readOnly={!canEdit || !isOwner}
        />
      </div>
    </>
  )
}
