import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import PeoplePicker from "../ui/PeoplePicker";
import PageLoading from "../ui/PageLoading";
import QueryError from "../ui/QueryError";
import { ipasService } from "../../services/ipasService";
import { IPAS_SIGNER_LISTS, IPAS_SIGNER_LIST, IPAS_SIGNER_LIST_LABELS } from "../../constants/ipas";
import { SELECTOR_TYPES } from "../../utils/resolvePeople";
import { ipasErrorMessage } from "../../utils/ipas";
import { ipasPendingPrefix, ipasSignerListsKey } from "./ipasKeys";

const WHO = {
  [IPAS_SIGNER_LIST.S1_APPROVED]: "Approves section 1: buying from and paying the supplier. Never the person who prepared it.",
  [IPAS_SIGNER_LIST.S3_APPROVED]: "Approves section 3: the importation charges and documents. Never the person who prepared it.",
  [IPAS_SIGNER_LIST.S7_RECEIVED]: "Receives the IPAS first when it is filed.",
  [IPAS_SIGNER_LIST.S7_NOTED]: "Notes the IPAS at filing, after it is received.",
  [IPAS_SIGNER_LIST.S7_CHECKED]: "Checks the IPAS at filing, after it is received.",
  [IPAS_SIGNER_LIST.S7_APPROVED]: "Approves section 7, which files the IPAS.",
};

/**
 * The sign-off lists (#247, spec #241), Super Admins only (the settings page
 * only offers this tab to them, and the database refuses anyone else's write).
 * Preparing needs Purchasing access; every other sign-off belongs to its list,
 * and a Super Admin signs only when they are on one, so they add themselves
 * here if they need to. Being on any list also lets someone read every IPAS.
 * Changing a list never changes what anyone already signed.
 */
export default function IpasSignerListEditor() {
  const queryClient = useQueryClient();

  const { data: lists, isLoading, isError, refetch } = useQuery({
    queryKey: ipasSignerListsKey,
    queryFn: () => ipasService.getSignerLists(),
  });

  const save = useMutation({
    mutationFn: ({ listKey, employeeIds }) => ipasService.setSignerList(listKey, employeeIds),
    onSuccess: () => {
      toast.success("Sign-off list saved.");
      queryClient.invalidateQueries({ queryKey: ipasSignerListsKey });
      queryClient.invalidateQueries({ queryKey: ipasPendingPrefix });
    },
    onError: (error) => {
      toast.error(ipasErrorMessage(error));
      queryClient.invalidateQueries({ queryKey: ipasSignerListsKey });
    },
  });

  if (isLoading) return <PageLoading label="sign-off lists" />;
  if (isError) return <QueryError title="The sign-off lists could not be loaded." onRetry={refetch} />;

  return (
    <div className="space-y-4" data-testid="ipas-signer-lists">
      <p className="rounded-xl bg-muted/60 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
        Anyone with Purchasing access prepares a section. Everything after that is signed by the people on its list,
        and a Super Admin signs only when they are on one: add yourself if you need to. Being on any list also lets
        someone read every IPAS. Changing a list never changes what has already been signed.
      </p>

      {IPAS_SIGNER_LISTS.map((listKey) => (
        <section key={listKey} className="rounded-xl border border-border bg-card p-4" data-testid={`ipas-signer-list-${listKey}`}>
          <h3 className="text-sm font-semibold text-foreground">{IPAS_SIGNER_LIST_LABELS[listKey]}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{WHO[listKey]}</p>
          <PeoplePicker
            className="mt-3"
            types={[SELECTOR_TYPES.EMPLOYEE]}
            placeholder="Add person"
            disabled={save.isPending}
            value={(lists?.[listKey] ?? []).map((member) => ({ type: SELECTOR_TYPES.EMPLOYEE, id: member.employeeId }))}
            onChange={(selectors) => save.mutate({ listKey, employeeIds: selectors.map((s) => s.id) })}
          />
          {(lists?.[listKey] ?? []).length === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">Nobody yet.</p>
          )}
        </section>
      ))}
    </div>
  );
}
