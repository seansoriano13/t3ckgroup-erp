import { useState, useEffect, useRef } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { BookmarkPlus, X, Check, Users, Calendar, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import Spinner from "@/components/ui/Spinner";
import { computeDueDateOffsetDays } from "../utils/templateApply";
import { Input } from "@/components/ui/input";
import { FieldBox } from "@/components/ui/FieldBox";

export default function SaveGroupTaskTemplateModal({
  isOpen,
  onClose,
  taskDraft = {},
  onSave,
  isSaving = false,
}) {
  const [templateName, setTemplateName] = useState("");
  const inputRef = useRef(null);

  const { title = "", members = [], dueDate = null } = taskDraft;
  const dueDateOffset = computeDueDateOffsetDays(dueDate);

  // Extract unique roles from members
  const roles = Array.from(
    new Set(
      members
        .map((m) => m.customRole || m.custom_role || m.role)
        .filter((r) => r && r.trim() !== ""),
    ),
  );

  useEffect(() => {
    if (isOpen) {
      // Resetting on open is the point: the modal keeps its fields mounted
      // between openings, so without this the next open shows the last
      // session's input. isOpen is the external event being followed.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTemplateName("");
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [isOpen]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = templateName.trim();
    if (!trimmed || isSaving) return;
    onSave(trimmed);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !isSaving && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="p-0 gap-0 z-[80] shadow-2xl flex flex-col w-[480px] max-w-[95vw] rounded-2xl overflow-hidden border border-border bg-card"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border/70">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-primary/10 text-primary border border-primary/20 shrink-0 shadow-sm">
              <BookmarkPlus size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Save as Template</h2>
              <p className="text-xs text-muted-foreground">
                Save this configuration for quick reuse later.
              </p>
            </div>
          </div>
          <Button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            variant="ghost" size="icon-xs"
          >
            <X size={16} />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col">
          <div className="px-6 py-5 flex flex-col gap-4">
            {/* Template Name Field */}
            <div className="flex flex-col gap-1.5">
              <FieldBox bare label={<>
                Template Name <span className="text-primary">*</span>
              </>}>
<Input
                ref={inputRef}
                type="text"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="e.g., Monthly Safety Audit, Project Kickoff"
                disabled={isSaving}
                containerClassName="w-full"
                autoComplete="off"
              />
</FieldBox>
            </div>

            {/* Snapshot Summary Preview */}
            <div className="bg-muted/40 border border-border/80 rounded-xl p-3.5 flex flex-col gap-2.5">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                <Layers size={11} /> Included in Template
              </span>

              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="font-medium">Task Title:</span>
                  <span className="font-semibold text-foreground truncate max-w-[240px]">
                    {title.trim() ? title.trim() : <span className="italic text-muted-foreground/60">Blank (filled on create)</span>}
                  </span>
                </div>

                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="font-medium flex items-center gap-1">
                    <Users size={12} /> Member Slots:
                  </span>
                  <span className="font-semibold text-foreground">
                    {members.length} slot{members.length === 1 ? "" : "s"}
                  </span>
                </div>

                {roles.length > 0 && (
                  <div className="flex items-center justify-between gap-2 text-muted-foreground pt-0.5">
                    <span className="font-medium shrink-0">Roles:</span>
                    <div className="flex items-center gap-1 flex-wrap justify-end">
                      {roles.map((role) => (
                        <span
                          key={role}
                          className="px-1.5 py-0.5 rounded-md bg-card border border-border text-[10px] font-semibold text-foreground"
                        >
                          {role}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="font-medium flex items-center gap-1">
                    <Calendar size={12} /> Due Date Offset:
                  </span>
                  <span className="font-semibold text-foreground">
                    {dueDateOffset != null ? (
                      `+${dueDateOffset} day${dueDateOffset === 1 ? "" : "s"} from creation`
                    ) : (
                      <span className="text-muted-foreground/60">None (manual pick)</span>
                    )}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-4 border-t border-border bg-muted/20 flex items-center justify-end gap-2.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={isSaving}
              className="text-xs font-semibold text-muted-foreground hover:text-foreground h-9 px-4 rounded-xl"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!templateName.trim() || isSaving}
              className="h-9 px-5 rounded-xl text-xs font-bold shadow-md shadow-primary/15"
            >
              {isSaving ? (
                <>
                  <Spinner size="xs" className="mr-2" />
                  <span>Saving…</span>
                </>
              ) : (
                <>
                  <Check size={14} strokeWidth={2.5} className="mr-1.5" />
                  <span>Save Template</span>
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
