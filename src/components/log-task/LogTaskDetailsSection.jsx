import { FileInput } from "@/components/ui/FileInput";
import { Receipt, ImagePlus, X, Maximize2, ClipboardPaste } from "lucide-react"
import { useState, useRef, useCallback, useEffect } from "react"
import { createPortal } from "react-dom"
import ChecklistTaskInput from "../ChecklistTaskInput"
import DictateButton from "./DictateButton"
import Spinner from "@/components/ui/Spinner"
import { storageService } from "../../services/storageService"
import toast from "react-hot-toast"
import { useProjectTitles } from "../../hooks/useProjectTitles"
import TemplateVariableChips from "@/components/ui/TemplateVariableChips"
import HighlightedTemplateField from "@/components/ui/HighlightedTemplateField"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input";

export default function LogTaskDetailsSection({
  formData,
  handleChange,
  titleRef,
  selectedEmployeeInfo,
  showChecklist,
  onToggleChecklist,
  onChecklistChange,
  isExpanded,
  onAttachmentsChange,
  mode = "normal",
}) {
  const descriptionRef = useRef(null)
  const dictationEmployeeId = formData?.loggedById || selectedEmployeeInfo?.id
  const projectTitles = useProjectTitles(dictationEmployeeId, true)
  const [isUploading, setIsUploading] = useState(false)
  const [fullscreenImage, setFullscreenImage] = useState(null)
  const fileInputRef = useRef(null)
  const attachmentsRef = useRef(formData.attachments || [])
  useEffect(() => {
    attachmentsRef.current = formData.attachments || []
  }, [formData.attachments])

  const uploadFiles = useCallback(
    async (files) => {
      if (!files || files.length === 0) return
      const current = attachmentsRef.current
      if (current.length + files.length > 5) {
        toast.error("Maximum 5 images allowed per task.")
        return
      }
      setIsUploading(true)
      try {
        const uploads = files
          .filter((f) => {
            if (!f.type.startsWith("image/")) {
              toast.error(`${f.name} is not an image.`)
              return false
            }
            if (f.size > 5 * 1024 * 1024) {
              toast.error(`${f.name} exceeds 5 MB.`)
              return false
            }
            return true
          })
          .map((f) => storageService.uploadToCloudinary(f))
        const urls = await Promise.all(uploads)
        onAttachmentsChange([...current, ...urls])
      } catch (err) {
        toast.error("Upload failed: " + err.message)
      } finally {
        setIsUploading(false)
      }
    },
    [onAttachmentsChange],
  )

  const handleRemove = (url) =>
    onAttachmentsChange((formData.attachments || []).filter((u) => u !== url))

  // Ctrl+V paste support
  useEffect(() => {
    const handlePaste = (e) => {
      const items = Array.from(e.clipboardData?.items || [])
      const imageItems = items.filter((item) => item.type.startsWith("image/"))
      if (imageItems.length === 0) return
      e.preventDefault()
      toast("Screenshot detected — uploading...", { icon: "📋" })
      const files = imageItems.map((item) => {
        const blob = item.getAsFile()
        return new File([blob], `paste_${Date.now()}.png`, { type: blob.type })
      })
      uploadFiles(files)
    }
    document.addEventListener("paste", handlePaste)
    return () => document.removeEventListener("paste", handlePaste)
  }, [uploadFiles])

  const attachments = formData.attachments || []
  return (
    <>
      {/* 1. PROJECT / CAMPAIGN TITLE */}
      <div className="animate-content-in stagger-1 relative">
        {mode === "automation" ? (
          <HighlightedTemplateField
            ref={titleRef}
            as="input"
            type="text"
            name="projectTitle"
            value={formData.projectTitle}
            onChange={handleChange}
            placeholder="Project / Campaign Title"
            className="text-lg font-semibold placeholder:text-mauve-6 pb-1"
            wrapperClassName="mb-1"
            autoComplete="off"
          />
        ) : (
          <Input
            ref={titleRef}
            type="text"
            name="projectTitle"
            value={formData.projectTitle}
            onChange={handleChange}
            placeholder="Project / Campaign Title"
            containerClassName="w-full mb-1" className="border-0 bg-transparent rounded-none px-0 py-0 shadow-none focus-visible:ring-0 h-auto text-lg font-semibold text-foreground bg-transparent outline-none placeholder:text-mauve-6 border-none pb-1"
            autoComplete="on"
            list="project-titles-list"
          />
        )}
        <datalist id="project-titles-list">
          {projectTitles.map((title) => (
            <option key={title} value={title} />
          ))}
        </datalist>
        {mode === "automation" && (
          <TemplateVariableChips
            value={formData.projectTitle}
            onInsert={(token) => titleRef.current?.insertToken(token)}
            className="mb-1"
          />
        )}
      </div>

      {/* Payment Voucher (ADMIN dept) */}
      {selectedEmployeeInfo.department?.toUpperCase() === "ADMIN" && (
        <div className="flex items-center gap-2.5 mb-3 px-3 py-2 bg-muted border border-mauve-3 rounded-lg animate-slide-down">
          <Receipt size={14} className="text-mauve-7 shrink-0" />
          <Input
            type="text"
            name="paymentVoucher"
            value={formData.paymentVoucher}
            onChange={handleChange}
            placeholder="Payment Voucher (e.g. PV001-2024)"
            containerClassName="flex-1" className="border-0 bg-transparent rounded-none px-0 py-0 shadow-none focus-visible:ring-0 h-auto bg-transparent border-none outline-none text-sm text-foreground placeholder:text-mauve-7"
            autoComplete="off"
          />
        </div>
      )}

      {/* 2. DESCRIPTION & CHECKLIST (both visible) */}
      <div className="mb-4 animate-content-in stagger-2">
        {/* Description textarea — always visible */}
        {mode === "automation" ? (
          <HighlightedTemplateField
            ref={descriptionRef}
            as="textarea"
            name="taskDescription"
            value={formData.taskDescription || ""}
            onChange={handleChange}
            placeholder="Add description…"
            className={`text-sm placeholder:text-mauve-6 ${isExpanded ? "h-48" : "h-24"}`}
          />
        ) : (
          <textarea
            ref={descriptionRef}
            name="taskDescription"
            value={formData.taskDescription || ""}
            onChange={handleChange}
            placeholder="Add description…"
            className={`w-full bg-transparent border-none outline-none transition-all resize-y text-sm text-foreground placeholder:text-mauve-6 ${
              isExpanded ? "h-48" : "h-24"
            }`}
          />
        )}
        {mode === "automation" && (
          <TemplateVariableChips
            value={formData.taskDescription}
            onInsert={(token) => descriptionRef.current?.insertToken(token)}
          />
        )}

        {/* Dictation + checklist affordances share one row under the description */}
        <div className="flex flex-wrap items-center gap-2">
          <DictateButton
            employeeId={dictationEmployeeId}
            text={formData.taskDescription || ""}
            phrases={projectTitles}
            onCommit={(next) =>
              handleChange({ target: { name: "taskDescription", value: next } })
            }
          />
          {!showChecklist && (
            <Button
              type="button"
              variant="ghost"
              onClick={onToggleChecklist}
              className="h-auto mt-1 flex items-center gap-1.5 text-[11px] font-bold text-muted-foreground hover:text-foreground transition-all py-1.5 px-2.5 rounded-lg hover:bg-muted"
            >
              <span className="text-base leading-none">+</span> Add checklist
            </Button>
          )}
        </div>

        {/* Checklist section — collapsible */}
        {showChecklist && (
          <div className="mt-2 animate-slide-down">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                Checklist
              </span>
              <Button
                type="button"
                variant="ghost"
                onClick={onToggleChecklist}
                className="h-auto text-[10px] font-bold text-muted-foreground hover:text-foreground transition-colors px-2 py-0.5 rounded hover:bg-muted"
              >
                Hide
              </Button>
            </div>
            <div className="bg-card rounded-xl border border-mauve-3 p-4">
              <ChecklistTaskInput
                value={formData.checklist ? (typeof formData.checklist === "string" ? formData.checklist : JSON.stringify(formData.checklist)) : ""}
                onChange={(e) => onChecklistChange(e.target.value)}
                name="checklist"
              />
            </div>
          </div>
        )}
      </div>
      {/* 3. IMAGE ATTACHMENTS */}
      <div className="mb-3 animate-content-in stagger-3">
        <FileInput
          ref={fileInputRef}
          onFiles={uploadFiles}
          accept="image/jpeg,image/png,image/webp"
          multiple
        />

        {/* Upload zone */}
        <div className="border-2 border-dashed border-mauve-12/20 rounded-xl hover:border-mauve-12/40 hover:bg-mauve-3 transition-all">
          {/* Thumbnail strip (inside zone) */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-3">
              {attachments.map((url, i) => (
                <div
                  key={url}
                  className="relative group w-14 h-14 rounded-lg overflow-hidden border border-mauve-4 bg-mauve-2 shrink-0"
                >
                  <img
                    src={url}
                    alt={`Attachment ${i + 1}`}
                    className="object-cover w-full h-full cursor-pointer"
                    onClick={() => setFullscreenImage(url)}
                  />
                  <div className="absolute inset-0 flex items-center justify-center gap-1 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => setFullscreenImage(url)}
                      className="h-auto w-auto p-1 text-white hover:text-white hover:bg-transparent"
                    >
                      <Maximize2 size={11} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleRemove(url)
                      }}
                      className="h-auto w-auto p-1 text-white hover:text-white hover:bg-transparent"
                    >
                      <X size={11} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Button row */}
          <Button
            type="button"
            variant="ghost"
            onClick={() => fileInputRef.current?.open()}
            disabled={isUploading || attachments.length >= 5}
            className="h-auto w-full flex items-center justify-center gap-2 px-3 py-3 text-[11px] font-semibold text-mauve-12/70 hover:text-mauve-12 hover:bg-transparent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isUploading ? (
              <>
                <Spinner size="sm" />
                <span>Uploading…</span>
              </>
            ) : attachments.length >= 5 ? (
              <span className="text-muted-foreground">
                5 / 5 images attached
              </span>
            ) : (
              <>
                <ImagePlus size={14} />
                <span>
                  {attachments.length > 0
                    ? `Add more images (${attachments.length}/5)`
                    : "Attach images"}
                </span>
                <span className="flex items-center gap-1 text-muted-foreground/60 font-normal ml-1">
                  <ClipboardPaste size={12} /> or paste
                </span>
              </>
            )}
          </Button>
        </div>

        {/* Fullscreen lightbox */}
        {fullscreenImage &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              className="fixed inset-0 z-[9999999] bg-black/90 flex items-center justify-center p-4 backdrop-blur-sm"
              onClick={() => setFullscreenImage(null)}
            >
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-6 right-6 h-auto w-auto text-white hover:text-destructive hover:bg-black/50 transition-colors bg-black/50 p-2 rounded-full"
                onClick={() => setFullscreenImage(null)}
              >
                <X size={24} />
              </Button>
              <img
                src={fullscreenImage}
                alt="Fullscreen Attachment"
                className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              />
            </div>,
            document.body
          )}
      </div>
    </>
  )
}
