import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { Button } from "../ui/button";
import { FieldBox } from "../ui/FieldBox";
import { Input } from "../ui/input";
import { costingMatrixService } from "../../services/costingMatrixService";

const KEY = ["costing", "landed-defaults"];

const validPercent = (text) => text.trim() !== "" && Number.isFinite(Number(text)) && Number(text) >= 0;

/**
 * Costing sheet (#702, spec #699): the add-on percent that estimates the landed cost until the IPAS has
 * the real one. A new matrix starts with the Import figure; a row paid in pesos takes the Local one.
 * Purchasing access and Super Admins edit it (the database decides).
 */
export default function LandedAddonDefaults() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState({});
  const [error, setError] = useState(null);

  const { data } = useQuery({ queryKey: KEY, queryFn: () => costingMatrixService.getLandedDefaults() });

  const save = useMutation({
    mutationFn: (values) => costingMatrixService.setLandedDefaults(values),
    onSuccess: () => {
      setDraft({});
      setError(null);
      toast.success("Landed cost add-ons saved.");
      queryClient.invalidateQueries({ queryKey: KEY });
    },
    onError: (err) => toast.error(err.message),
  });

  const shown = {
    import: draft.import ?? String(data?.import ?? 0),
    local: draft.local ?? String(data?.local ?? 0),
  };

  const onSave = () => {
    if (!validPercent(shown.import) || !validPercent(shown.local)) {
      setError("Type 0 or a number above it for both add-ons.");
      return;
    }
    setError(null);
    save.mutate({ import: Number(shown.import), local: Number(shown.local) });
  };

  const field = (name, label) => (
    <FieldBox label={`${label} add-on %`} bare>
      <Input
        type="number"
        min={0}
        step="0.01"
        inputMode="decimal"
        className="w-24"
        aria-label={`${label} add-on percent`}
        value={shown[name]}
        onChange={(e) => {
          setError(null);
          setDraft((d) => ({ ...d, [name]: e.target.value }));
        }}
      />
    </FieldBox>
  );

  return (
    <section className="space-y-3 border-t border-border pt-6" aria-labelledby="landed-addon-heading">
      <div>
        <h2 id="landed-addon-heading" className="text-sm font-semibold text-foreground">
          Landed cost add-on
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          The Costing sheet estimates a landed cost from the peso price until the IPAS has the real one. A new matrix
          starts with the Import add-on, and Purchasing can change it on that matrix. A row priced in pesos takes the
          Local add-on.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        {field("import", "Import")}
        {field("local", "Local")}
        <Button type="button" onClick={onSave} disabled={save.isPending || Object.keys(draft).length === 0}>
          Save add-ons
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
