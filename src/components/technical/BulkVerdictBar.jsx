import { useState } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { refusalMessage } from "../costing/gridFormat";
import { costingMatrixService } from "../../services/costingMatrixService";

/**
 * The "Set verdict" bar of the Technical sheet (#932): shown once the in-charge has checked products. It sets Complies,
 * Deviates or Not judged on every checked product. Deviates asks for one remark first and applies it to each of them.
 * `onDone` runs after a save (the sheet reads again and clears the checks).
 */
export default function BulkVerdictBar({ ids, components = [], onDone }) {
  const [askingRemark, setAskingRemark] = useState(false);
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  // The verdict waiting on the "change them too?" answer, and the products the answer settled on.
  const [pendingVerdict, setPendingVerdict] = useState(undefined);
  const [targetIds, setTargetIds] = useState(null);

  const judgedChecked = components.filter((c) => ids.includes(c.id) && (c.compliance === "complies" || c.compliance === "deviates"));
  const deviating = judgedChecked.filter((c) => c.compliance === "deviates").length;

  // A verdict button: when some checked products are already judged, ask before touching them (#1035).
  const choose = (verdict) => {
    if (judgedChecked.length === 0) return begin(verdict, ids);
    setPendingVerdict(verdict);
  };
  const begin = (verdict, scope) => {
    setPendingVerdict(undefined);
    if (verdict === "deviates") {
      setTargetIds(scope);
      setAskingRemark(true);
      return;
    }
    apply(verdict, undefined, scope);
  };

  const apply = async (verdict, note, scope = targetIds ?? ids) => {
    setBusy(true);
    setError(null);
    try {
      if (scope.length > 0) await costingMatrixService.setComplianceMany(scope, { verdict, note });
      setAskingRemark(false);
      setTargetIds(null);
      setRemark("");
      await onDone?.();
    } catch (err) {
      setError(refusalMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2" data-testid="bulk-verdict-bar">
      <span className="text-sm font-medium text-foreground">
        {ids.length} {ids.length === 1 ? "product" : "products"} checked
      </span>
      <span className="text-xs text-muted-foreground">Set verdict</span>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => choose("complies")}>
        Complies
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => choose("deviates")}>
        Deviates
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => choose(null)}>
        Not judged
      </Button>

      {pendingVerdict !== undefined && (
        <div className="flex w-full flex-wrap items-center gap-2" data-testid="bulk-verdict-ask">
          <p className="text-sm text-foreground">
            {judgedChecked.length} {judgedChecked.length === 1 ? "is" : "are"} already judged
            {deviating > 0 ? ` (${deviating} Deviates)` : ""}. Change {judgedChecked.length === 1 ? "it" : "them"} too?
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              const judgedIds = new Set(judgedChecked.map((c) => c.id));
              begin(pendingVerdict, ids.filter((id) => !judgedIds.has(id)));
            }}
          >
            Only the unjudged
          </Button>
          <Button type="button" size="sm" disabled={busy} onClick={() => begin(pendingVerdict, ids)}>
            All checked
          </Button>
        </div>
      )}

      {askingRemark && (
        <form
          className="flex w-full flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            apply("deviates", remark);
          }}
        >
          <Input
            aria-label="Remark for every checked product"
            className="min-w-56 flex-1"
            placeholder="Why they deviate (needed)"
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            autoFocus
          />
          <Button type="submit" size="sm" disabled={busy || !remark.trim()}>
            Set Deviates
          </Button>
        </form>
      )}

      {error && (
        <p role="alert" className="w-full text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
