import { useState, useRef, useEffect, useCallback } from "react";
import { pluralize } from "@/utils/plural";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { X, XSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldBox } from "@/components/ui/FieldBox";

export default function BulkDeclineModal({
  isOpen,
  onClose,
  selectedCount,
  onConfirm,
  isSubmitting,
}) {
  const [remarks, setRemarks] = useState("");
  const titleRef = useRef(null);

  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRemarks("");
      setTimeout(() => titleRef.current?.focus(), 150);
    }
  }, [isOpen]);

  const handleSubmit = useCallback((e) => {
    if (e?.preventDefault) e.preventDefault();
    if (isSubmitting) return;
    if (!remarks.trim()) return; // Require remarks for decline
    onConfirm({ remarks });
  }, [remarks, onConfirm, isSubmitting]);

  // Keyboard shortcut Ctrl+Enter to submit
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, handleSubmit]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="p-0 gap-0 z-[70] shadow-[0_10px_40px_-10px_rgba(79,70,229,0.15)] flex flex-col transition-all duration-300 w-[500px] sm:max-w-none max-w-[95vw] rounded-2xl max-h-[90vh] overflow-hidden"
      >
        {/* HEADER */}
        <div className="flex items-center justify-between px-5 pt-4 pb-2 border-b border-mauve-3/40 shrink-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="w-[18px] h-[18px] rounded flex items-center justify-center bg-destructive text-primary-foreground font-bold text-[9px] shrink-0">
              <XSquare size={10} />
            </div>
            <span className="font-bold text-muted-foreground">Bulk Decline</span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            className="rounded-md text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            aria-label="Close"
          >
            <X size={15} />
          </Button>
        </div>

        {/* BODY */}
        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-6">
          <div tabIndex={-1} ref={titleRef} className="outline-none">
            <h2 className="text-xl font-extrabold text-foreground tracking-tight">
              Decline {pluralize(selectedCount, "Task")}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Provide feedback for declining the {pluralize(selectedCount, "selected task")}. A remark is required.
            </p>
          </div>

          <div>
            <FieldBox label="Decline Remarks (Required)" className="mb-2 block" />
            <Input
              type="text"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="e.g. Please revise these tasks…"
              className="w-full bg-card mt-1 focus:ring-primary/50"
              required
            />
          </div>
        </form>

        {/* FOOTER */}
        <div className="px-5 py-4 border-t border-border bg-muted/30 flex justify-end gap-3 rounded-b-2xl">
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !remarks.trim()}
            className="bg-destructive hover:bg-red-700 text-primary-foreground font-bold tracking-wide shadow-sm"
          >
            {isSubmitting ? "Processing…" : `Decline ${pluralize(selectedCount, "Task")}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
