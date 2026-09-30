import { DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// One size for every record that carries a Chat: 16px inset, 1400px max width,
// rounded, dimmed backdrop (from Dialog). No size switcher.
export const RECORD_MODAL_CLASS =
  "!top-4 !left-1/2 !-translate-x-1/2 !translate-y-0 h-[calc(100vh-2rem)] max-h-none !w-[calc(100vw-2rem)] !max-w-[1400px] sm:!max-w-[1400px] gap-0 overflow-hidden rounded-2xl p-0 shadow-2xl outline-none";

export function RecordModalContent({ className, ...props }) {
  return <DialogContent className={cn(RECORD_MODAL_CLASS, className)} {...props} />;
}
