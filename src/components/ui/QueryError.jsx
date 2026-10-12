import { Button } from "@/components/ui/button";

/**
 * The one query-failure block: short message plus Retry. Never prints a raw
 * error message to the user; log it instead.
 */
export default function QueryError({ title = "Could not load this", onRetry, className = "" }) {
  return (
    <div
      role="alert"
      className={`rounded-xl border border-red-6 bg-red-a2 px-5 py-8 text-center ${className}`}
    >
      <p className="text-sm font-semibold text-red-11">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">Could not load this. Try again.</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={() => onRetry()}>
          Retry
        </Button>
      )}
    </div>
  );
}
