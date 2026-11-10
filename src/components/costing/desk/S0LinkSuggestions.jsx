import { Link2 } from "lucide-react";

import { Button } from "../../ui/button";

/**
 * Typed lines whose name looks like an S0 line that has no row yet (#727). Nothing is linked by name:
 * these are offers, and only Sales can confirm one. The database judges the link; this only lists them.
 */
export default function S0LinkSuggestions({ suggestions, canConfirm, busy, onConfirm }) {
  if (!suggestions?.length) return null;
  return (
    <section className="space-y-2 rounded-xl border border-border bg-muted/40 px-3 py-2 text-[13px]" data-testid="s0-link-suggestions" aria-label="Typed lines that may be S0 lines">
      <p className="font-semibold">Is this the same line? Confirm to link a typed line to the S0.</p>
      <ul className="space-y-1.5">
        {suggestions.map((s) => (
          <li key={`${s.sorItemId}:${s.tenderLineId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="min-w-0 flex-1">
              Typed &quot;{s.tenderLineName}&quot; may be S0 &quot;{s.sorItemName}&quot;
            </span>
            {canConfirm && (
              <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={() => onConfirm(s)}>
                <Link2 size={12} aria-hidden="true" />
                Link to the S0 line
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
