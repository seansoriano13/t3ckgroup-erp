import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldBox } from "@/components/ui/FieldBox";
import { Input } from "@/components/ui/input";
import { ipasService } from "../../services/ipasService";
import { ipasSorSearchKey } from "./ipasKeys";

const FOUND_IN = { origin: "Source Document", analytic: "Analytic account" };

function SorLine({ sor }) {
  return (
    <span className="min-w-0 text-[13px]">
      <span className="font-mono font-semibold">{sor.sales_reference}</span>
      <span className="text-muted-foreground"> · {sor.project_title}</span>
      {sor.client_name && <span className="text-muted-foreground"> · {sor.client_name}</span>}
    </span>
  );
}

/**
 * The SORs a Project IPAS names. `suggestions` are the SORs the PO's Source
 * Document or analytic accounts mention (one tick each); anything else is
 * found by Sales Reference, project or customer. `selected` and `onChange` are
 * lists of `{ id, sales_reference, project_title, client_name }`.
 */
export default function SorPicker({ selected, onChange, suggestions = [], disabled = false }) {
  const [term, setTerm] = useState("");
  const search = term.trim();

  const { data: results = [], isFetching } = useQuery({
    queryKey: ipasSorSearchKey(search),
    queryFn: () => ipasService.searchSors(search),
    enabled: search.length >= 2,
    staleTime: 30_000,
  });

  const selectedIds = new Set(selected.map((s) => s.id));
  const toggle = (sor, on) =>
    onChange(on ? [...selected.filter((s) => s.id !== sor.id), sor] : selected.filter((s) => s.id !== sor.id));

  const suggestedIds = new Set(suggestions.map((s) => s.id));
  const picked = selected.filter((s) => !suggestedIds.has(s.id));
  const addable = results.filter((r) => !selectedIds.has(r.id) && !suggestedIds.has(r.id));

  return (
    <div className="space-y-3">
      {suggestions.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Mentioned on the Odoo PO</p>
          {suggestions.map((sor) => (
            <FieldBox
              inline
              key={sor.id}
              className="rounded-lg border border-border px-2.5 py-2 hover:bg-muted/40"
            >
              <Checkbox
                checked={selectedIds.has(sor.id)}
                disabled={disabled}
                onCheckedChange={(on) => toggle(sor, on)}
                aria-label={`Name ${sor.sales_reference}`}
              />
              <SorLine sor={sor} />
              <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                {(sor.found_in || []).map((w) => FOUND_IN[w]).join(" · ")}
              </span>
            </FieldBox>
          ))}
        </div>
      )}

      {picked.length > 0 && (
        <ul className="space-y-1.5">
          {picked.map((sor) => (
            <li key={sor.id} className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-2">
              <SorLine sor={sor} />
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="ml-auto"
                aria-label={`Remove ${sor.sales_reference}`}
                disabled={disabled}
                onClick={() => toggle(sor, false)}
              >
                <X size={12} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <FieldBox label="Find another SOR" bare>
        <Input
          value={term}
          disabled={disabled}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Sales Reference, project or customer"
        />
      </FieldBox>
      {search.length >= 2 && (
        <ul className="space-y-1">
          {addable.map((sor) => (
            <li key={sor.id} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-muted/40">
              <SorLine sor={sor} />
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="ml-auto"
                disabled={disabled}
                onClick={() => {
                  toggle(sor, true);
                  setTerm("");
                }}
              >
                <Plus size={12} />
                Add
              </Button>
            </li>
          ))}
          {!isFetching && addable.length === 0 && (
            <li className="px-2.5 py-1.5 text-xs text-muted-foreground">No other SOR matches.</li>
          )}
        </ul>
      )}
    </div>
  );
}
