import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { Switch } from "../ui/switch";
import { ipasService } from "../../services/ipasService";
import { ipasErrorMessage } from "../../utils/ipas";
import { ipasFileRulesKey } from "./ipasKeys";

/**
 * The two file switches on the Document kinds tab (#959): proof of payment on every payment,
 * and a file on every charge. Super Admins change them (the database refuses others, so
 * everyone else sees them read only). A change applies to every open IPAS at once.
 */
export default function IpasFileRulesSwitches({ isSuperAdmin = false }) {
  const queryClient = useQueryClient();
  const { data: rules } = useQuery({ queryKey: ipasFileRulesKey, queryFn: () => ipasService.getFileRules() });

  const save = useMutation({
    mutationFn: (changes) => ipasService.setFileRules(changes),
    onSuccess: () => {
      toast.success("Saved. Open IPAS follow it now.");
      queryClient.invalidateQueries({ queryKey: ipasFileRulesKey });
      queryClient.invalidateQueries({ queryKey: ["ipas", "one"] });
    },
    onError: (error) => {
      toast.error(ipasErrorMessage(error));
      queryClient.invalidateQueries({ queryKey: ipasFileRulesKey });
    },
  });

  const rows = [
    { key: "proofOnEveryPayment", field: "proof_on_every_payment", label: "Proof of payment on every payment", hint: "Each payment needs its proof attached before 2 · Payments is signed." },
    { key: "fileOnEveryCharge", field: "file_on_every_charge", label: "A file on every charge", hint: "Each charge with an amount needs its file before 3 · Costs is signed." },
  ];

  return (
    <section className="space-y-2 rounded-xl border border-border bg-card p-4" data-testid="ipas-file-rules">
      <h3 className="text-sm font-semibold text-foreground">Files on payments and charges</h3>
      {rows.map((row) => (
        <label key={row.key} className="flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="block text-[13px] font-medium text-foreground">{row.label}</span>
            <span className="block text-xs text-muted-foreground">{row.hint}</span>
          </span>
          <Switch
            size="sm"
            checked={rules ? Boolean(rules[row.field]) : true}
            disabled={!isSuperAdmin || !rules || save.isPending}
            aria-label={row.label}
            onCheckedChange={(on) => save.mutate({ [row.key]: on })}
          />
        </label>
      ))}
      {!isSuperAdmin && <p className="text-xs text-muted-foreground">Only a Super Admin changes these.</p>}
    </section>
  );
}
