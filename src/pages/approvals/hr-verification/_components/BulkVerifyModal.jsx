import { useState, useRef, useEffect, useCallback } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { X, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function BulkVerifyModal({
  isOpen,
  onClose,
  selectedCount,
  onConfirm,
  isSubmitting,
}) {
  const [notes, setNotes] = useState("");
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  const titleRef = useRef(null);

  // Reset form state during render when modal transitions from closed to open.
  // This avoids calling setState inside useEffect, which triggers cascading re-renders.
  if (isOpen && !prevIsOpen) {
    setPrevIsOpen(true);
    setNotes("");
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
    onConfirm({ notes });
  }, [notes, onConfirm]);

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
            <div className="w-[18px] h-[18px] rounded flex items-center justify-center bg-blue-9 text-primary-foreground font-bold text-[9px] shrink-0">
              <ShieldCheck size={10} />
            </div>
            <span className="font-bold text-muted-foreground">
              Bulk HR Verification
            </span>
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
              Verify {selectedCount} Tasks
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              HR sign-off for {selectedCount} task(s). This does{" "}
              <span className="font-bold text-foreground">not</span> change
              grades — it marks them as officially verified for payroll.
            </p>
          </div>

          {/* Info callout */}
          <div className="flex gap-3 bg-blue-a2 border border-blue-a4 rounded-xl p-4">
            <ShieldCheck size={18} className="text-blue-10 mt-0.5 shrink-0" />
            <div className="text-sm text-blue-11">
              <p className="font-bold mb-0.5">What this does</p>
              <p className="text-xs leading-relaxed">
                Sets Tasks to{" "}
                <code className="font-mono bg-blue-a3 px-1 rounded">
                  verified
                </code>{" "}
                on all selected tasks. Grades and remarks set by Heads remain
                unchanged.
              </p>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 block">
              HR Verification Notes (Optional)
            </label>
            <Input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Verified for April payroll cycle"
              className="w-full bg-card mt-1 focus:ring-primary/50"
            />
          </div>
        </form>

        {/* FOOTER */}
        <div className="px-5 py-4 border-t border-border bg-muted/30 flex justify-end gap-3 rounded-b-2xl">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="bg-blue-10 hover:bg-blue-11 text-primary-foreground font-bold tracking-wide shadow-sm"
          >
            {isSubmitting
              ? "Verifying..."
              : `Verify & Sign ${selectedCount} Tasks`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
