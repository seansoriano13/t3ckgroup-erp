import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FieldBox } from "@/components/ui/FieldBox";
import { Input } from "@/components/ui/input";
import HighlightText from "../HighlightText";
import { ipasService } from "../../services/ipasService";
import { ipasRecentSorsKey, ipasSorSearchKey } from "./ipasKeys";

const FOUND_IN = { origin: "Source Document", analytic: "Analytic account" };

/**
 * One SOR as the picker names it: SOR number, SO number when it has one,
 * project and Stage, with the typed text highlighted.
 */
function SorLine({ sor, search = "" }) {
  return (
    <span className="min-w-0 text-[13px]">
      <span className="font-mono font-semibold">
        <HighlightText text={sor.sor_code || ""} search={search} />
      </span>
      {sor.sales_reference && (
        <span className="font-mono text-muted-foreground">
          {" "}
          · <HighlightText text={sor.sales_reference} search={search} />
        </span>
      )}
      <span className="text-muted-foreground">
        {" "}
        · <HighlightText text={sor.project_title || ""} search={search} />
      </span>
      {sor.current_stage_name && <span className="text-muted-foreground"> · {sor.current_stage_name}</span>}
    </span>
  );
}

const nameOf = (sor) => sor.sor_code || sor.sales_reference || sor.project_title;

/**
 * The SORs a Project IPAS names. `suggestions` are the SORs the PO's Source
 * Document or analytic accounts mention (one tick each); with `showRecent`,
 * the caller's last SORs on other IPAS follow them (Purchasing only). Anything
 * else is found by SOR number, SO number or project. `selected` and `onChange`
 * are lists of `{ id, sor_code, sales_reference, project_title,
 * current_stage_name }`; `sales_reference` is null until Odoo has a sales order.
 */
export default function SorPicker({ selected, onChange, suggestions = [], showRecent = false, disabled = false }) {
  const [term, setTerm] = useState("");
  const search = term.trim();

  const { data: results = [], isFetching, isError } = useQuery({
    queryKey: ipasSorSearchKey(search),
    queryFn: () => ipasService.searchSors(search),
    enabled: search.length >= 2,
    staleTime: 30_000,
  });

  const { data: recentAll = [] } = useQuery({
    queryKey: ipasRecentSorsKey,
    queryFn: () => ipasService.recentSors(),
    enabled: showRecent,
    staleTime: 30_000,
  });

  const selectedIds = new Set(selected.map((s) => s.id));
  const toggle = (sor, on) =>
    onChange(on ? [...selected.filter((s) => s.id !== sor.id), sor] : selected.filter((s) => s.id !== sor.id));

  const suggestedIds = new Set(suggestions.map((s) => s.id));
  const recents = recentAll.filter((s) => !suggestedIds.has(s.id));
  const listedIds = new Set([...suggestedIds, ...recents.map((s) => s.id)]);
  const picked = selected.filter((s) => !listedIds.has(s.id));
  const addable = results.filter((r) => !selectedIds.has(r.id) && !listedIds.has(r.id));

  const tickRow = (sor, note) => (
    <FieldBox inline key={sor.id} className="rounded-lg border border-border px-2.5 py-2 hover:bg-muted/40">
      <Checkbox
        checked={selectedIds.has(sor.id)}
        disabled={disabled}
        onCheckedChange={(on) => toggle(sor, on)}
        aria-label={`Name ${nameOf(sor)}`}
      />
      <SorLine sor={sor} search={search} />
      {note && <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">{note}</span>}
    </FieldBox>
  );

  return (
    <div className="space-y-3">
      {suggestions.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Mentioned on the Odoo PO</p>
          {suggestions.map((sor) => tickRow(sor, (sor.found_in || []).map((w) => FOUND_IN[w]).join(" · ")))}
        </div>
      )}

      {recents.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Picked recently</p>
          {recents.map((sor) => tickRow(sor))}
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
                aria-label={`Remove ${nameOf(sor)}`}
                disabled={disabled}
                onClick={() => toggle(sor, false)}
              >
                <X size={12} />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <FieldBox label={picked.length || listedIds.size ? "Find another SOR" : "Find an SOR"} bare>
        <Input
          value={term}
          disabled={disabled}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="SOR number, SO number or project"
        />
      </FieldBox>
      {search.length >= 2 && (
        <ul className="space-y-1">
          {addable.map((sor) => (
            <li key={sor.id} className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-muted/40">
              <SorLine sor={sor} search={search} />
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
          {isError ? (
            <li className="px-2.5 py-1.5 text-xs text-destructive">SORs couldn't be searched. Try again.</li>
          ) : (
            !isFetching &&
            addable.length === 0 && <li className="px-2.5 py-1.5 text-xs text-muted-foreground">No other SOR matches.</li>
          )}
        </ul>
      )}
    </div>
  );
}
