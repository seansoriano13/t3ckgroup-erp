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
export default function BulkVerdictBar({ ids, onDone }) {
  const [askingRemark, setAskingRemark] = useState(false);
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const apply = async (verdict, note) => {
    setBusy(true);
    setError(null);
    try {
      await costingMatrixService.setComplianceMany(ids, { verdict, note });
      setAskingRemark(false);
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
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => apply("complies")}>
        Complies
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setAskingRemark(true)}>
        Deviates
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => apply(null)}>
        Not judged
      </Button>

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
