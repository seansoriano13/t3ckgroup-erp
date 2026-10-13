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
import { ipasKey, ipasListKey, ipasPendingKey, ipasPendingPrefix } from "../../../components/ipas/ipasKeys";
import { ipasService } from "../../../services/ipasService";
import { ipasToItem } from "../../../utils/approvalItems.js";
import { ipasErrorMessage } from "../../../utils/ipas";
import { useRecordParam } from "../../../hooks/useRecordParam";
import { APPROVAL_QUEUES, useApprovalRoles } from "../_components/useApprovalQueues";
import { ApprovalCenterLayout } from "../_components/ApprovalCenterLayout";
import { ApprovalToolbar } from "../_components/ApprovalToolbar";
import { ApprovalTable } from "../_components/ApprovalTable";
import { ApprovalSheet } from "../_components/ApprovalSheet";
import { IpasSignoffReview } from "../_components/IpasSignoffReview";

const QUEUE = APPROVAL_QUEUES.find((q) => q.key === "ipas");

/**
 * IPAS Sign-offs (#247, spec #241) in the Approval Center: every IPAS section 1
 * or 3 that Purchasing has prepared and that waits on the signed-in person, who
 * is on that section's approval list and didn't prepare it. Approve signs it;
 * Send back returns it to its preparer with a reason. The IPAS itself is one
 * click from the review sheet.
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
    mutationFn: (item) => ipasService.sign(item.source.ipasId, item.source.section, "approved"),
    onSuccess: (_, item) => {
      toast.success(`${item.ref} section ${item.source.section} approved.`);
      advance(item);
      settled(item);
    },
    onError: (error) => toast.error(ipasErrorMessage(error)),
  });

  const sendBack = useMutation({
    mutationFn: ({ item, reason }) => ipasService.sendBack(item.source.ipasId, item.source.section, reason),
    onSuccess: (_, { item }) => {
      toast.success(`${item.ref} section ${item.source.section} sent back to its preparer.`);
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
            personLabel="Prepared by"
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
          personLabel="Prepared by"
          onOpen={(item) => openRecord(item.id)}
          searchTerm={search}
          keyboard={!open}
          renderRowAction={(item) => (
            <>
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
              <Tooltip content="Approve">
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={`Approve ${item.ref} section ${item.source.section}`}
                  disabled={busy}
                  className="hover:border-green-7 hover:bg-green-3 hover:text-green-11"
                  onClick={() => approve.mutate(item)}
                >
                  <Check size={14} />
                </Button>
              </Tooltip>
            </>
          )}
          empty={{
            title: "Nothing waiting on you right now",
            description: "IPAS sections that Purchasing has prepared for your approval show up here.",
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
            onApprove={(it) => approve.mutate(it)}
            onSendBack={setSendingBack}
          />
        )}
      </ApprovalSheet>

      <SendBackDialog
        open={sendingBack !== null}
        onOpenChange={(next) => !next && setSendingBack(null)}
        title={sendingBack ? `Send ${sendingBack.ref} section ${sendingBack.source.section} back?` : "Send back?"}
        description="It clears Prepared and Approved for this section and tells whoever prepared it. The history keeps what was cleared."
        onSubmit={(reason) => sendBack.mutateAsync({ item: sendingBack, reason })}
      />
    </>
  );
}
