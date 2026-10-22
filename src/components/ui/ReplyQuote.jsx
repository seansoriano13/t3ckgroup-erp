import { cn } from "@/lib/utils";

/**
 * The quoted snippet rendered inside a message bubble when that message
 * was sent as a reply to an earlier one.
 */
export default function ReplyQuote({ replyTo, className }) {
  if (!replyTo) return null;
  return (
    <div
      className={cn(
        "mb-1.5 pl-2 py-0.5 border-l-2 border-current/30 rounded-sm text-[11px] opacity-75 max-w-full",
        className,
      )}
    >
      <p className="font-bold truncate">{replyTo.authorName}</p>
      <p className={cn("truncate", replyTo.removed && "italic")}>
        {replyTo.removed ? "Message removed" : replyTo.content}
      </p>
    </div>
  );
}
