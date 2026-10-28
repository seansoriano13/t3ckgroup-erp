import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import PeoplePicker from "../../ui/PeoplePicker";
import PageLoading from "../../ui/PageLoading";
import QueryError from "../../ui/QueryError";
import { SelectField } from "../../ui/SelectField";
import { costingEvaluationSettingsService } from "../../../services/costingEvaluationSettingsService";
import { SELECTOR_TYPES } from "../../../utils/resolvePeople";

const NONE = "__none__";
const templateKey = ["costing", "settings", "evaluation", "template"];
const templatesKey = ["costing", "settings", "evaluation", "templates"];
const signersKey = ["costing", "settings", "evaluation", "signers"];

const message = (error) => (error?.message || "Something went wrong.").replace(/^[a-z_]+: /, "");

/**
 * The Evaluation of Specification settings (#271, spec #266), Super Admins only (the database
 * refuses anyone else's write): which group task template calls Technical in, and who is on the
 * `evaluation` list that approves the evaluation. A member of a task made from the template, on
 * an SOR, may write Compliance on that SOR's Costing Matrix; leaving it empty grants that to
 * nobody. Changing the list never changes an approval already given.
 */
export default function EvaluationSection() {
  const queryClient = useQueryClient();

  const template = useQuery({ queryKey: templateKey, queryFn: () => costingEvaluationSettingsService.getTemplateId() });
  const templates = useQuery({ queryKey: templatesKey, queryFn: () => costingEvaluationSettingsService.getTemplates() });
  const signers = useQuery({ queryKey: signersKey, queryFn: () => costingEvaluationSettingsService.getSigners() });

  const saveTemplate = useMutation({
    mutationFn: (templateId) => costingEvaluationSettingsService.setTemplateId(templateId),
    onSuccess: () => toast.success("Evaluation template saved."),
    onError: (error) => toast.error(message(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: templateKey }),
  });

  const saveSigners = useMutation({
    mutationFn: (employeeIds) => costingEvaluationSettingsService.setSigners(employeeIds),
    onSuccess: () => toast.success("Evaluation list saved."),
    onError: (error) => toast.error(message(error)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: signersKey }),
  });

  if (template.isLoading || templates.isLoading || signers.isLoading) return <PageLoading label="evaluation settings" />;
  if (template.isError || templates.isError || signers.isError) {
    return (
      <QueryError
        title="The evaluation settings could not be loaded."
        onRetry={() => {
          template.refetch();
          templates.refetch();
          signers.refetch();
        }}
      />
    );
  }

  const templateId = template.data ?? null;
  const options = [{ value: NONE, label: "None" }, ...(templates.data ?? []).map((t) => ({ value: t.id, label: t.name }))];
  // A template that was archived since still shows by id, so the setting never looks empty when it is not.
  if (templateId && !options.some((o) => o.value === templateId)) options.push({ value: templateId, label: "An archived template" });

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4" data-testid="costing-evaluation-settings" aria-label="Evaluation of Specification">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Evaluation of Specification</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          Who evaluates an S0 Evaluation, and who approves the evaluation. A Compliance verdict is written by Purchasing access and by
          the members of an SOR&apos;s evaluation task. The approval is signed by one person on the list below.
        </p>
      </div>

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-foreground" id="costing-evaluation-template-label">
          Evaluation task template
        </p>
        <SelectField
          aria-labelledby="costing-evaluation-template-label"
          className="w-full max-w-sm"
          options={options}
          value={templateId ?? NONE}
          disabled={saveTemplate.isPending}
          onChange={(next) => saveTemplate.mutate(next === NONE ? null : next)}
        />
        <p className="text-xs text-muted-foreground">
          {templateId
            ? "Members of a task made from this template, on an SOR, can write Compliance on its matrix."
            : "No template chosen: only Purchasing access and Super Admins write Compliance."}
        </p>
      </div>

      <div className="space-y-1.5" data-testid="costing-evaluation-list">
        <p className="text-xs font-medium text-foreground">Evaluation list</p>
        <p className="text-xs text-muted-foreground">
          Approves the evaluation once for the whole matrix. A Super Admin approves only when on this list.
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
