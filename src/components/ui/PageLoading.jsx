import Spinner from "@/components/ui/Spinner";

/**
 * The one page/section loading state: spinner plus a sentence-case "Loading X…".
 * Pass the noun ("task approvals"), not the sentence.
 */
export default function PageLoading({ label = "", className = "" }) {
  const text = label ? `Loading ${label}…` : "Loading…";
  return (
    <div
      role="status"
      className={`flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground ${className}`}
    >
      <Spinner size="md" />
      <p className="text-sm font-medium">{text}</p>
    </div>
  );
}
