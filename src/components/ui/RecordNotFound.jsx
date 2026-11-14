import { SearchX } from "lucide-react";
import EmptyState from "./EmptyState";
import { Button } from "./button";

/**
 * The one "not found" block for a record screen (#1027): a deleted record, one the reader may not
 * open, or an id that is not an id. Same title everywhere; `recordType` names what was looked for
 * and `onBack` (with `backLabel`) is the way back.
 */
export default function RecordNotFound({ recordType = "record", onBack, backLabel = "Go back", className = "" }) {
  return (
    <EmptyState
      icon={SearchX}
      title="Not found, or not yours to see"
      description={`This ${recordType} may have been deleted, or you may not have access to it.`}
      className={className}
      action={
        onBack ? (
          <Button type="button" variant="outline" size="sm" onClick={onBack} className="mt-2">
            {backLabel}
          </Button>
        ) : null
      }
    />
  );
}
