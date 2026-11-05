import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import PeoplePicker from "../../ui/PeoplePicker";
import PageLoading from "../../ui/PageLoading";
import QueryError from "../../ui/QueryError";
import { costingEvaluationSettingsService } from "../../../services/costingEvaluationSettingsService";
import { SELECTOR_TYPES } from "../../../utils/resolvePeople";

const signersKey = ["costing", "settings", "evaluation", "signers"];

const message = (error) => (error?.message || "Something went wrong.").replace(/^[a-z_]+: /, "");

/**
 * The Evaluation of Specification settings (#271, spec #266), Super Admins only (the database
 * refuses anyone else's write): who is on the `evaluation` list that approves the evaluation. The
 * Technical verdict is given by the in-charge named on each SOR (#908). Changing the list never
 * changes an approval already given.
 */
export default function EvaluationSection() {
  const queryClient = useQueryClient();

  const signers = useQuery({ queryKey: signersKey, queryFn: () => costingEvaluationSettingsService.getSigners() });

  const saveSigners = useMutation({
    mutationFn: (employeeIds) => costingEvaluationSettingsService.setSigners(employeeIds),
    onSuccess: () => toast.success("Evaluation list saved."),
    onError: (error) => toast.error(message(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: signersKey }),
  });

  if (signers.isLoading) return <PageLoading label="evaluation settings" />;
  if (signers.isError) return <QueryError title="The evaluation settings could not be loaded." onRetry={() => signers.refetch()} />;

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4" data-testid="costing-evaluation-settings" aria-label="Evaluation of Specification">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Evaluation of Specification</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          Who approves an S0 Evaluation. The Technical verdict is given by the Technical in-charge named on each SOR. The approval is
          signed by one person on the list below, from the Technical page.
        </p>
      </div>

      <div className="space-y-1.5" data-testid="costing-evaluation-list">
        <p className="text-xs font-medium text-foreground">Evaluation list</p>
        <p className="text-xs text-muted-foreground">
          Approves the evaluation once for the whole matrix. A Super Admin approves only when on this list, and the Technical
          in-charge never approves their own SOR.
        </p>
        <PeoplePicker
          types={[SELECTOR_TYPES.EMPLOYEE]}
          placeholder="Add person"
          disabled={saveSigners.isPending}
          value={(signers.data ?? []).map((id) => ({ type: SELECTOR_TYPES.EMPLOYEE, id }))}
          onChange={(selectors) => saveSigners.mutate(selectors.map((s) => s.id))}
        />
        {(signers.data ?? []).length === 0 && <p className="text-xs text-muted-foreground">Nobody yet.</p>}
      </div>
    </section>
  );
}
