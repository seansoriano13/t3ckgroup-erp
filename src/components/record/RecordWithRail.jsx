import SidePanel from "@/components/ui/SidePanel";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";

/**
 * A record's body and its "Your move" rail (#989). The rail is a SidePanel: a right
 * column from 1440px wide on a tall screen; a "Your move" button above the body on a
 * smaller laptop; and on a phone a sticky bottom bar ("Your move · <what is next>")
 * that opens the card in a bottom sheet, so the next action is on the first screen.
 *
 * `status` is the one line saying what is next (shown in the phone bar). `children` is
 * the body; `rail` is the card.
 */
export default function RecordWithRail({ status, rail, children, className }) {
  const phone = useMediaQuery("(max-width: 767.98px)");
  const label = phone && status ? `Your move · ${status}` : "Your move";
  return (
    <div className={cn("flex min-w-0 flex-col gap-4 max-md:pb-16 min-[1440px]:flex-row min-[1440px]:gap-8", className)}>
      <div className="min-w-0 flex-1 space-y-6">{children}</div>
      <div className="order-first min-[1440px]:sticky min-[1440px]:top-2 min-[1440px]:order-last min-[1440px]:self-start">
        <SidePanel label={label} trigger="sticky" width="25rem" inlineFrom={1440}>
          {rail}
        </SidePanel>
      </div>
    </div>
  );
}
