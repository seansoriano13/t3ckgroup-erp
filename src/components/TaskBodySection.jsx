import { FolderKanban, Receipt } from "lucide-react"
import SorLink from "./sor/SorLink"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import ChecklistTaskInput from "./ChecklistTaskInput"
import ChecklistTaskRenderer from "./ChecklistTaskRenderer"
import HighlightText from "./HighlightText"
import ImageAttachment from "./ImageAttachment"
import { useProjectTitles } from "../hooks/useProjectTitles"
import { FieldBox } from "@/components/ui/FieldBox";

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
  onClose,
}) {
  const projectTitles = useProjectTitles(task?.loggedById || task?.logged_by || user?.id, isEditing);

  // Where the task came from and what it is filed against. Editing keeps it
  // near the top with the other inputs; viewing puts it after the work itself.
  const sourceAndVoucher = (
    <>
      {/* --- OPPORTUNITY LINK --- */}
      <SorLink opportunityId={task?.opportunityId || task?.opportunity_id} onClose={onClose} />

      {/* --- PAYMENT VOUCHER --- */}
      {((isEditing && taskDept?.toUpperCase() === "ADMIN") ||
        formData.paymentVoucher) && (
        <div className="flex flex-col gap-1.5 pt-2">
          <FieldBox label={<><Receipt size={12} /> Payment Voucher
            {isEditing && (
              <span className="font-normal text-muted-foreground normal-case tracking-normal">
                (optional)
              </span>
            )}</>} className="pl-1" />
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
            <div className="bg-muted px-4 py-3 rounded-xl border border-border/50 text-sm font-bold text-foreground flex items-center gap-2">
              <Receipt size={14} />
              {formData.paymentVoucher}
            </div>
          )}
        </div>
      )}
    </>
  )

  return (
    <>
      {/* --- PROJECT / CAMPAIGN TITLE ---
          View mode shows it as the modal's title (TaskHeader), so only the
          input lives here. */}
      {isEditing && (
        <div className="flex flex-col gap-1.5 pt-2">
          <FieldBox label={<><FolderKanban size={12} /> Project / Campaign Title
            <span className="font-normal text-muted-foreground normal-case tracking-normal">
              (optional)
            </span></>} className="pl-1" />
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
        </div>
      )}

      {isEditing && sourceAndVoucher}

      {/* --- OTHERS DETAILS --- */}
      {isEditing && isOthersGlobal && (
        <div className="flex flex-col gap-1.5 pt-2 animate-slide-down">
          <FieldBox label="Others Details" className="pl-1" />
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
              <FieldBox label="Description" className="pl-1 block mb-1" />
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
                    <FieldBox label="Checklist" className="pl-1" />
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setShowChecklist(false)}
                      className="h-auto text-[10px] font-bold text-muted-foreground hover:text-foreground transition-colors px-2 py-0.5 rounded hover:bg-muted"
                    >
                      Hide
                    </Button>
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
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowChecklist(true)}
                  className="h-auto flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground hover:text-foreground transition-all py-1.5 px-2.5 rounded-lg hover:bg-muted"
                >
                  <span className="text-base leading-none">+</span> Add checklist
                </Button>
              )}
            </div>
          </div>
        ) : (
          /* VIEW MODE — description reads straight on from the title, as
             prose, then the checklist the assignee works through. */
          <div className="flex flex-col gap-6">
            {formData.taskDescription?.trim() && (
              <div className="max-w-[70ch] text-[15px] leading-relaxed text-foreground whitespace-pre-wrap break-words">
                <HighlightText text={formData.taskDescription} search={searchTerm} />
              </div>
            )}

            {hasChecklist && (
              <div>
                <FieldBox label="Checklist" className="pl-1 mb-2" />
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
               <div className="text-sm text-muted-foreground italic">
                 No description or checklist provided.
               </div>
            )}
          </div>
        )}
      </div>

      {!isEditing && sourceAndVoucher}

      {/* --- ATTACHMENTS (all tasks, owner only) --- */}
      <div className="flex flex-col gap-1.5 pt-2 border-t border-border mt-2">
        <FieldBox label="Attachments" className="pl-1" />
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
