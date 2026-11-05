import { Dialog } from "@/components/ui/dialog";
import { RecordModalContent } from "@/components/ui/record-modal";

/**
 * The SOR window while its record is still on the way (#904). It is the same
 * record frame, with grey bars where the header and the first Stage Visit will
 * sit, so the window opens at once instead of as a blank panel.
 */
export default function SorWindowSkeleton({ isOpen, onClose }) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose?.()}>
      <RecordModalContent
        showCloseButton={false}
        className="z-[70] flex flex-col shadow-[0_12px_40px_-12px_rgba(0,0,0,0.22)]"
      >
        <div role="status" aria-label="Loading SOR" className="flex min-h-0 flex-1 flex-col gap-5 p-6">
          <span className="sr-only">Loading SOR…</span>
          <div className="space-y-2.5">
            <div className="h-7 w-2/5 animate-pulse rounded-md bg-muted" />
            <div className="h-4 w-1/4 animate-pulse rounded-md bg-muted/70" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="h-16 animate-pulse rounded-xl bg-muted/70" />
            <div className="h-16 animate-pulse rounded-xl bg-muted/70" />
          </div>
          <div className="space-y-2.5">
            <div className="h-4 w-full animate-pulse rounded-md bg-muted/70" />
            <div className="h-4 w-5/6 animate-pulse rounded-md bg-muted/70" />
            <div className="h-4 w-2/3 animate-pulse rounded-md bg-muted/70" />
          </div>
        </div>
      </RecordModalContent>
    </Dialog>
  );
}
