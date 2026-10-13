import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Clock, CornerUpLeft, Layers } from "lucide-react";
import toast from "react-hot-toast";
import PageLoading from "@/components/ui/PageLoading";
import QueryError from "@/components/ui/QueryError";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/Tooltip";
import ProtectedRoute from "../../../components/ProtectedRoute";
import SendBackDialog from "../../../components/ipas/SendBackDialog";
import FilingDialog from "../../../components/ipas/FilingDialog";
import { ipasKey, ipasListKey, ipasPendingKey, ipasPendingPrefix } from "../../../components/ipas/ipasKeys";
import { ipasService } from "../../../services/ipasService";
import { IPAS_SIGNOFF_ROLE, IPAS_SIGNOFF_ROLE_ACTIONS, IPAS_SIGNOFF_ROLE_LABELS } from "../../../constants/ipas";
import { ipasToItem } from "../../../utils/approvalItems.js";
import { ipasErrorMessage } from "../../../utils/ipas";
import { canSendBackItem } from "../../../utils/ipasSignoffs";
import { useRecordParam } from "../../../hooks/useRecordParam";
import { APPROVAL_QUEUES, useApprovalRoles } from "../_components/useApprovalQueues";
import { ApprovalCenterLayout } from "../_components/ApprovalCenterLayout";
import { ApprovalToolbar } from "../_components/ApprovalToolbar";
import { ApprovalTable } from "../_components/ApprovalTable";
import { ApprovalSheet } from "../_components/ApprovalSheet";
import { IpasSignoffReview } from "../_components/IpasSignoffReview";

const QUEUE = APPROVAL_QUEUES.find((q) => q.key === "ipas");

/**
 * IPAS Sign-offs (#247, #248, spec #241) in the Approval Center: every IPAS
 * section 1 or 3 that Purchasing has prepared and that waits on the signed-in
 * person (on that section's approval list, and not its preparer), and every
 * section 7 step that is theirs to give once the one before it is. Approve signs
 * it; Send back returns a section 1 or 3 to its preparer with a reason, and
 * returns section 7 (Received, Noted and Checked) from any step after Received;
 * section 7's Approved goes through the dialog that lists the required documents
 * nobody has ticked and files the IPAS. The IPAS itself is one click from the
 * review sheet.
 */
export default function IpasSignoffsPage() {
  return (
    <ProtectedRoute requireIpasApprover>
      <IpasSignoffsQueue />
    </ProtectedRoute>
  );
}

function IpasSignoffsQueue() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useApprovalRoles();

  const [view, setView] = useState("ALL");
  const [search, setSearch] = useState("");
  const [person, setPerson] = useState("ALL");
  const [sendingBack, setSendingBack] = useState(null);
  const [filing, setFiling] = useState(null); // the section 7 Approved being filed
  const { recordId, open: openRecord, step: stepRecord, close: closeRecord } = useRecordParam();

  const pendingQuery = useQuery({
    queryKey: ipasPendingKey(user?.id),
    queryFn: () => ipasService.pendingSignoffsFor(user.id),
    enabled: !!user?.id,
  });

  const all = useMemo(() => (pendingQuery.data || []).map((p) => ipasToItem(p)), [pendingQuery.data]);
  const stale = all.filter((i) => i.isStale);
  const active = all.filter((i) => !i.isStale);
  const source = view === "STALE" ? stale : view === "ACTIVE" ? active : all;

  const people = useMemo(() => {
    const m = new Map();
    for (const i of source) m.set(i.person.id, { id: i.person.id, name: i.person.name, count: (m.get(i.person.id)?.count || 0) + 1 });
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [source]);

  const needle = search.trim().toLowerCase();
  const items = source.filter(
    (i) =>
      (person === "ALL" || i.person.id === person) &&
      (!needle || [i.title, i.ref, i.typeLabel, i.person.name].some((f) => (f || "").toLowerCase().includes(needle))),
  );

  const index = items.findIndex((i) => String(i.id) === recordId);
  const open = index >= 0 ? items[index] : null;

  const settled = (item) => {
    queryClient.invalidateQueries({ queryKey: ipasPendingPrefix });
    queryClient.invalidateQueries({ queryKey: ipasKey(item.source.ipasId) });
    queryClient.invalidateQueries({ queryKey: ipasListKey });
  };

  // The next record to land on once this one leaves the queue.
  const advance = (item) => {
    const at = items.findIndex((i) => i.id === item.id);
    const next = items[at + 1] || items[at - 1];
    if (String(item.id) !== recordId) return;
    if (next) stepRecord(next.id);
    else closeRecord();
  };

  const approve = useMutation({
    mutationFn: ({ item, confirm }) =>
      ipasService.sign(item.source.ipasId, item.source.section, item.source.role, { confirm }),
    onSuccess: (result, { item }) => {
      if (result.filed) toast.success(`${item.ref} is filed.`);
      else if (item.source.section === 7) {
        toast.success(`${item.ref} section 7 ${IPAS_SIGNOFF_ROLE_LABELS[item.source.role].toLowerCase()}.`);
      } else toast.success(`${item.ref} section ${item.source.section} approved.`);
      advance(item);
      settled(item);
    },
    onError: (error) => toast.error(ipasErrorMessage(error)),
  });

  // Section 7's Approved files the IPAS, so it asks first (the dialog lists the
  // required documents nobody has ticked); every other step is one click.
  const give = (item) => {
    if (item.source.section === 7 && item.source.role === IPAS_SIGNOFF_ROLE.APPROVED) setFiling(item);
    else approve.mutate({ item, confirm: false });
  };
  const verbOf = (item) =>
    item.source.section === 7 ? IPAS_SIGNOFF_ROLE_ACTIONS[item.source.role] : "Approve";

  const sendBack = useMutation({
    mutationFn: ({ item, reason }) => ipasService.sendBack(item.source.ipasId, item.source.section, reason),
    onSuccess: (_, { item }) => {
      toast.success(
        item.source.section === 7
          ? `${item.ref} section 7 sent back. The people who had signed it were told.`
          : `${item.ref} section ${item.source.section} sent back to its preparer.`,
      );
      advance(item);
      settled(item);
    },
    onError: (error) => toast.error(ipasErrorMessage(error)),
  });

  if (pendingQuery.isError) {
    return (
      <QueryError className="m-6" title="IPAS sign-offs could not be loaded." onRetry={pendingQuery.refetch} />
    );
  }

  if (pendingQuery.isLoading) {
    return <PageLoading label="IPAS sign-offs" />;
  }

  const busy = approve.isPending || sendBack.isPending;

  return (
    <>
      <ApprovalCenterLayout
        toolbar={
          <ApprovalToolbar
            views={[
              { value: "ALL", label: "All Pending", icon: Layers, badge: all.length || undefined },
              { value: "ACTIVE", label: "Active (<48h)", icon: Clock, badge: active.length || undefined },
              { value: "STALE", label: "Stale Backlog (≥48h)", icon: AlertTriangle, badge: stale.length || undefined },
            ]}
            view={view}
            onViewChange={(v) => {
              setView(v);
              setPerson("ALL");
            }}
            people={people}
            person={person}
            onPersonChange={setPerson}
            personLabel="Handed over by"
            search={search}
            onSearchChange={setSearch}
          />
        }
      >
        <ApprovalTable
          items={items}
          filtered={source.length > 0}
          onClearFilters={() => {
            setSearch("");
            setPerson("ALL");
          }}
          queueIcon={QUEUE.icon}
          personLabel="Handed over by"
          onOpen={(item) => openRecord(item.id)}
          searchTerm={search}
          keyboard={!open}
          renderRowAction={(item) => (
            <>
              {canSendBackItem(item.source) && (
                <Tooltip content="Send back">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    aria-label={`Send back ${item.ref} section ${item.source.section}`}
                    disabled={busy}
                    onClick={() => setSendingBack(item)}
                  >
                    <CornerUpLeft size={14} />
                  </Button>
                </Tooltip>
              )}
              <Tooltip
                content={
                  item.source.section === 7 && item.source.role === IPAS_SIGNOFF_ROLE.APPROVED
                    ? "Approve and file"
                    : verbOf(item)
                }
              >
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={`${verbOf(item)} ${item.ref} section ${item.source.section}`}
                  disabled={busy}
                  className="hover:border-green-7 hover:bg-green-3 hover:text-green-11"
                  onClick={() => give(item)}
                >
                  <Check size={14} />
                </Button>
              </Tooltip>
            </>
          )}
          empty={{
            title: "Nothing waiting on you right now",
            description:
              "IPAS sign-offs that are ready for you show up here: prepared sections for approval, and section 7's steps as each one before it is given.",
          }}
        />
      </ApprovalCenterLayout>

      <ApprovalSheet
        item={open}
        queueLabel={QUEUE.label}
        queueIcon={QUEUE.icon}
        index={index}
        total={items.length}
        onStep={(d) => {
          const to = items[index + d];
          if (to) stepRecord(to.id);
        }}
        onClose={closeRecord}
        onOpenDetails={open ? () => navigate(`/purchasing/ipas/${open.source.ipasId}`) : undefined}
      >
        {(item) => (
          <IpasSignoffReview
            key={item.id}
            item={item}
            isSubmitting={busy}
            onApprove={give}
            onSendBack={setSendingBack}
          />
        )}
      </ApprovalSheet>

      <FilingDialog
        open={filing !== null}
        onOpenChange={(next) => !next && setFiling(null)}
        ipasId={filing?.source.ipasId}
        number={filing?.ref}
        onConfirm={() => approve.mutateAsync({ item: filing, confirm: true })}
      />

      <SendBackDialog
        open={sendingBack !== null}
        onOpenChange={(next) => !next && setSendingBack(null)}
        title={sendingBack ? `Send ${sendingBack.ref} section ${sendingBack.source.section} back?` : "Send back?"}
        description={
          sendingBack?.source.section === 7
            ? "It clears Received, Noted and Checked and tells the people who gave them. Sections 1 and 3 stay approved. The history keeps what was cleared."
            : "It clears Prepared and Approved for this section and tells whoever prepared it. The history keeps what was cleared."
        }
        placeholder={sendingBack?.source.section === 7 ? "What needs fixing before it is filed?" : undefined}
        onSubmit={(reason) => sendBack.mutateAsync({ item: sendingBack, reason })}
      />
    </>
  );
}
