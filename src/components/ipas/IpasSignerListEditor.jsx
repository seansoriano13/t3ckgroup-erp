import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

import PeoplePicker from "../ui/PeoplePicker";
import PageLoading from "../ui/PageLoading";
import QueryError from "../ui/QueryError";
import { ipasService } from "../../services/ipasService";
import { IPAS_SIGNER_LISTS, IPAS_SIGNER_LIST, IPAS_SIGNER_LIST_LABELS, ipasSectionNo } from "../../constants/ipas";
import {
  TRANSMITTAL_STAFF_LIST,
  TRANSMITTAL_STAFF_LIST_LABELS,
  TRANSMITTAL_STAFF_LISTS,
} from "../../constants/transmittals";
import { SELECTOR_TYPES } from "../../utils/resolvePeople";
import { ipasErrorMessage } from "../../utils/ipas";
import { formatDate } from "../../utils/formatDate.js";
import { ipasPendingPrefix, ipasSignerListLogKey, ipasSignerListsKey } from "./ipasKeys";

const LOG_LIMIT = 20;

const WHO = {
  [IPAS_SIGNER_LIST.S1_APPROVED]: `Approves section ${ipasSectionNo(1)}: buying from and paying the supplier. Never the person who prepared it.`,
  [IPAS_SIGNER_LIST.S3_APPROVED]: `Approves section ${ipasSectionNo(3)}: the importation charges and documents. Never the person who prepared it.`,
  [IPAS_SIGNER_LIST.S7_RECEIVED]: "Receives the IPAS first when it is filed.",
  [IPAS_SIGNER_LIST.S7_NOTED]: "Notes the IPAS at filing, after it is received.",
  [IPAS_SIGNER_LIST.S7_CHECKED]: "Checks the IPAS at filing, after it is received.",
  [IPAS_SIGNER_LIST.S7_APPROVED]: `Approves section ${ipasSectionNo(7)}, which files the IPAS.`,
  [TRANSMITTAL_STAFF_LIST.WAREHOUSE]: "Signs a Transmittal's Warehouse checking and releasing; may raise one and sign Received in Odoo. Reads Transmittals, not the IPAS.",
  [TRANSMITTAL_STAFF_LIST.TECHNICAL]: "Signs a Transmittal's Technical inspection and is the TCA in-charge. Reads Transmittals, not the IPAS.",
  [TRANSMITTAL_STAFF_LIST.LOGISTICS]: "May raise a Transmittal. Reads Transmittals, not the IPAS.",
  [TRANSMITTAL_STAFF_LIST.CHECK_BY]: "Checks a finished Transmittal (two different people close it) and signs off Canvasses as the purchasing approver. Reads Transmittals, not the IPAS.",
};

const ALL_LISTS = [...IPAS_SIGNER_LISTS, ...TRANSMITTAL_STAFF_LISTS];
const ALL_LIST_LABELS = { ...IPAS_SIGNER_LIST_LABELS, ...TRANSMITTAL_STAFF_LIST_LABELS };

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
      queryClient.invalidateQueries({ queryKey: ipasSignerListLogKey });
      queryClient.invalidateQueries({ queryKey: ipasPendingPrefix });
    },
    onError: (error) => {
      toast.error(ipasErrorMessage(error));
      queryClient.invalidateQueries({ queryKey: ipasSignerListsKey });
    },
  });

  // The last few changes, so a Super Admin can see who edited the lists and when.
  const log = useQuery({
    queryKey: ipasSignerListLogKey,
    queryFn: () => ipasService.getSignerListLog({ limit: LOG_LIMIT }),
  });

  if (isLoading) return <PageLoading label="sign-off lists" />;
  if (isError) return <QueryError title="The sign-off lists could not be loaded." onRetry={refetch} />;

  return (
    <div className="space-y-4" data-testid="ipas-signer-lists">
      <p className="rounded-xl bg-muted/60 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
        Anyone with Purchasing access prepares a section. Everything after that is signed by the people on its list,
        and a Super Admin signs only when they are on one: add yourself if you need to. Being on an IPAS list lets
        someone read every IPAS; the Transmittal lists read Transmittals only. Changing a list never changes what has
        already been signed.
      </p>

      {ALL_LISTS.map((listKey) => (
        <section key={listKey} className="rounded-xl border border-border bg-card p-4" data-testid={`ipas-signer-list-${listKey}`}>
          <h3 className="text-sm font-semibold text-foreground">{ALL_LIST_LABELS[listKey]}</h3>
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

      <section className="rounded-xl border border-border bg-card p-4" data-testid="ipas-signer-list-log">
        <h3 className="text-sm font-semibold text-foreground">Who changed the lists</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">The last {LOG_LIMIT} changes, newest first.</p>
        {log.isError ? (
          <p className="mt-2 text-xs text-muted-foreground">The history could not be loaded.</p>
        ) : (log.data ?? []).length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">{log.isLoading ? "Loading…" : "No changes yet."}</p>
        ) : (
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {log.data.map((entry) => (
              <li key={entry.id} data-testid="ipas-signer-list-log-entry">
                <span className="font-medium text-foreground">{entry.actorName ?? "Someone"}</span>{" "}
                {entry.action === "added" ? "added" : "removed"}{" "}
                <span className="font-medium text-foreground">{entry.employeeName ?? "someone"}</span>{" "}
                {entry.action === "added" ? "to" : "from"} {IPAS_SIGNER_LIST_LABELS[entry.listKey] ?? entry.listKey} ·{" "}
                {formatDate(entry.at)}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
