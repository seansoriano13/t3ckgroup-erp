import { useState, useRef, useEffect, useCallback } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { X, CheckSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import GradeSelector from "../../../components/GradeSelector.jsx";

export default function BulkGradeModal({
  isOpen,
  onClose,
  selectedCount,
  onConfirm,
  isSubmitting,
}) {
  const [grade, setGrade] = useState(3);
  const [remarks, setRemarks] = useState("Bulk approved via system bypass");
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  const titleRef = useRef(null);

  // Reset form state during render when modal transitions from closed to open.
  // This avoids calling setState inside useEffect, which would cause cascading re-renders.
  if (isOpen && !prevIsOpen) {
    setPrevIsOpen(true);
    setGrade(3);
    setRemarks("Bulk approved via system bypass");
  } else if (!isOpen && prevIsOpen) {
    setPrevIsOpen(false);
  }

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => titleRef.current?.focus(), 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleSubmit = useCallback((e) => {
    if (e?.preventDefault) e.preventDefault();
    if (grade === null || grade < 1 || grade > 5) return;
    onConfirm({ grade, remarks });
  }, [grade, remarks, onConfirm]);

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
            <div className="w-[18px] h-[18px] rounded flex items-center justify-center bg-green-9 text-primary-foreground font-bold text-[9px] shrink-0">
              <CheckSquare size={10} />
            </div>
            <span className="font-bold text-muted-foreground">Bulk Evaluation</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* BODY */}
        <form onSubmit={handleSubmit} className="p-5 flex flex-col gap-6">
          <div tabIndex={-1} ref={titleRef} className="outline-none">
            <h2 className="text-xl font-extrabold text-foreground tracking-tight">
              Approve {selectedCount} Tasks
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Assign a standard grade and feedback note to all {selectedCount} selected tasks.
            </p>
          </div>

          <div>
            <label className="text-[10px] font-bold text-primary uppercase tracking-wider mb-2 block">
              Assign Grade (1-5)
            </label>
            <div className="mt-1">
              <GradeSelector grade={grade} onSelect={setGrade} canEvaluate={true} />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 block">
              Evaluation Remarks
            </label>
            <Input
              type="text"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="e.g. Bulk approved via system bypass"
              className="w-full bg-card mt-1 focus:ring-primary/50"
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
            disabled={isSubmitting || !grade}
            className="bg-green-10 hover:bg-green-11 text-primary-foreground font-bold tracking-wide shadow-sm"
          >
            {isSubmitting ? "Processing..." : `Approve ${selectedCount} Tasks`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
