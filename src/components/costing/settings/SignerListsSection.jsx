import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import PeoplePicker from "../../ui/PeoplePicker";
import PageLoading from "../../ui/PageLoading";
import QueryError from "../../ui/QueryError";
import { costingMatrixService } from "../../../services/costingMatrixService";
import { COSTING_SIGNER_LIST_LABEL } from "../../../constants/costing";
import { SELECTOR_TYPES } from "../../../utils/resolvePeople";
import { costingKeys } from "../costingKeys";

/**
 * One Costing Matrix signer list (#270, reused by #271 for the Evaluation of Specification list):
 * the people on it, picked from the employees. `listKey` is `final_acquire` or `evaluation`;
 * `description` says what being on it lets someone do. Anyone signed in sees who is on it; only
 * Super Admins change it (`canEdit`), and the database refuses everyone else.
 */
export default function SignerListsSection({ listKey, description, canEdit = false }) {
  const queryClient = useQueryClient();
  const lists = useQuery({ queryKey: costingKeys.signerLists, queryFn: () => costingMatrixService.getSignerLists() });

  const save = useMutation({
    mutationFn: (employeeIds) => costingMatrixService.setSignerList(listKey, employeeIds),
    onSuccess: () => {
      toast.success("List saved.");
      queryClient.invalidateQueries({ queryKey: ["costing"] });
    },
    onError: (error) => {
      toast.error(error?.message || "The list could not be saved.");
      queryClient.invalidateQueries({ queryKey: costingKeys.signerLists });
    },
  });

  if (lists.isLoading) return <PageLoading label="the list" />;
  if (lists.isError) return <QueryError title="The list could not be loaded." onRetry={lists.refetch} />;

  const members = lists.data?.[listKey] ?? [];
  const label = COSTING_SIGNER_LIST_LABEL[listKey] ?? listKey;

  return (
    <section className="rounded-xl border border-border bg-card p-4" data-testid={`costing-signer-list-${listKey}`}>
      <h3 className="text-sm font-semibold text-foreground">{label}</h3>
      {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      <PeoplePicker
        className="mt-3"
        types={[SELECTOR_TYPES.EMPLOYEE]}
        placeholder="Add person"
        disabled={!canEdit || save.isPending}
        value={members.map((member) => ({ type: SELECTOR_TYPES.EMPLOYEE, id: member.employeeId }))}
        onChange={(selectors) => save.mutate(selectors.map((s) => s.id))}
      />
      {members.length === 0 && <p className="mt-2 text-xs text-muted-foreground">Nobody yet.</p>}
      {!canEdit && <p className="mt-2 text-xs text-muted-foreground">Only a Super Admin changes this list.</p>}
    </section>
  );
}
