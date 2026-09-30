import SlideOver from "@/components/ui/SlideOver";
import { relativeAge } from "../../../utils/approvalItems.js";
import { StatusPill } from "./ApprovalParts";

const identity = (item) => ({
  ref: item.ref,
  title: item.title,
  badge: <StatusPill item={item} />,
  subtitle: `submitted ${relativeAge(item.submittedAt)}`,
});

/** The Approval Center's slide-over: a queue item's identity on the shared SlideOver. */
export function ApprovalSheet({ item, queueLabel, queueIcon, index, total, onStep, onClose, onOpenDetails, children }) {
  return (
    <SlideOver
      record={item}
      icon={queueIcon}
      crumb={queueLabel}
      identity={identity}
      index={index}
      total={total}
      onStep={onStep}
      onClose={onClose}
      onOpenFull={onOpenDetails}
    >
      {children}
    </SlideOver>
  );
}
