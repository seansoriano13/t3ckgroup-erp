import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Layers, X } from "lucide-react";
import toast from "react-hot-toast";
import PageLoading from "@/components/ui/PageLoading";
import QueryError from "@/components/ui/QueryError";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/Tooltip";
import ProtectedRoute from "../../../components/ProtectedRoute";
import { meetingRequestService } from "../../../services/meetingRequestService";
import { meetingToItem } from "../../../utils/approvalItems.js";
import { useRecordParam } from "../../../hooks/useRecordParam";
import { APPROVAL_QUEUES, useApprovalQueues } from "../_components/useApprovalQueues";
import { ApprovalCenterLayout } from "../_components/ApprovalCenterLayout";
import { ApprovalToolbar } from "../_components/ApprovalToolbar";
import { ApprovalTable } from "../_components/ApprovalTable";
import { ApprovalSheet } from "../_components/ApprovalSheet";
import { MeetingReview } from "../_components/MeetingReview";

const QUEUE = APPROVAL_QUEUES.find((q) => q.key === "meetings");
const DONE_TEXT = { APPROVE: "Approved.", DECLINE: "Declined.", RETURN: "Returned." };

/**
 * Meeting Requests (#624) in the Approval Center. A head sees the pending-head requests routed to
 * them; HR and Super Admins see pending-HR requests plus pending-head ones (with the override).
 */
export default function MeetingApprovalsPage() {
  return (
    <ProtectedRoute>
      <MeetingApprovalsQueue />
    </ProtectedRoute>
  );
}

function MeetingApprovalsQueue() {
  const queryClient = useQueryClient();
  const q = useApprovalQueues();
  const { user, isHr, isSuperAdmin } = q.roles;
  const canOverride = isHr || isSuperAdmin;

  const { recordId, open: openRecord, step: stepRecord, close: closeRecord } = useRecordParam();
  const [search, setSearch] = useState("");
  const [person, setPerson] = useState("ALL");

  const all = useMemo(
    () => q.meetingsPending.map((r) => meetingToItem(r)).sort((a, b) => new Date(a.clockAt) - new Date(b.clockAt)),
    [q.meetingsPending],
  );
  const people = useMemo(() => {
    const m = new Map();
    for (const i of all) m.set(i.person.id, { id: i.person.id, name: i.person.name, count: (m.get(i.person.id)?.count || 0) + 1 });
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [all]);

  const needle = search.trim().toLowerCase();
  const items = all.filter(
    (i) =>
      (person === "ALL" || i.person.id === person) &&
      (!needle || [i.person.name, i.source.purpose, i.source.venue?.name, i.ref].some((f) => (f || "").toLowerCase().includes(needle))),
  );
  const index = items.findIndex((i) => String(i.id) === recordId);
  const open = index >= 0 ? items[index] : null;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["meeting-requests"] });

  const decide = useMutation({
    mutationFn: ({ item, decision, note }) =>
      meetingRequestService.decide({ requestId: item.id, decision, note, actor: user }),
    onSuccess: (_d, { decision }) => {
      toast.success(DONE_TEXT[decision]);
      refresh();
    },
    onError: (err) => toast.error(err.message || "Could not record the decision."),
  });

  const override = useMutation({
    mutationFn: ({ item, reason }) => meetingRequestService.overrideHead({ requestId: item.id, reason, actor: user }),
    onSuccess: () => {
      toast.success("Head step skipped. It now waits for HR.");
      refresh();
    },
    onError: (err) => toast.error(err.message || "Could not skip the head step."),
  });

  const stepAfter = (item) => {
    const at = items.findIndex((i) => i.id === item.id);
    const next = items[at + 1] || items[at - 1];
    if (String(item.id) !== recordId) return;
    if (next) stepRecord(next.id);
    else closeRecord();
  };
  const onDecide = (item, decision, note) => decide.mutate({ item, decision, note }, { onSuccess: () => stepAfter(item) });
  const onOverride = (item, reason) => override.mutate({ item, reason }, { onSuccess: () => stepAfter(item) });
  const busy = decide.isPending || override.isPending;

  if (q.isErrorMeetings) return <QueryError className="m-6" title="Meeting requests could not be loaded." onRetry={q.refetchMeetings} />;
  if (q.isLoadingMeetings) return <PageLoading label="meeting requests" />;

  return (
    <>
      <ApprovalCenterLayout
        toolbar={
          <ApprovalToolbar
            views={[{ value: "ALL", label: "All Pending", icon: Layers, badge: all.length || undefined }]}
            view="ALL"
            onViewChange={() => setPerson("ALL")}
            people={people}
            person={person}
            onPersonChange={setPerson}
            personLabel="Requested by"
            search={search}
            onSearchChange={setSearch}
          />
        }
      >
        <ApprovalTable
          items={items}
          filtered={all.length > 0}
          onClearFilters={() => {
            setSearch("");
            setPerson("ALL");
          }}
          queueIcon={QUEUE.icon}
          personLabel="Requested by"
          onOpen={(item) => openRecord(item.id)}
          searchTerm={search}
          keyboard={!open}
          renderRowAction={(item) => (
            <>
              <Tooltip content="Review to decline or return">
                <Button variant="outline" size="icon-sm" aria-label={`Review ${item.person.name}'s meeting request`} disabled={busy} onClick={() => openRecord(item.id)}>
                  <X size={14} />
                </Button>
              </Tooltip>
              <Tooltip content="Approve">
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={`Approve ${item.person.name}'s meeting request`}
                  disabled={busy}
                  className="hover:border-green-7 hover:bg-green-3 hover:text-green-11"
                  onClick={() => onDecide(item, "APPROVE", "")}
                >
                  <Check size={14} />
                </Button>
              </Tooltip>
            </>
          )}
          empty={{ title: "Nothing waiting on you right now", description: "Meeting Requests routed to you, or waiting for HR, show up here." }}
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
      >
        {(item) => (
          <MeetingReview key={item.id} item={item} onDecide={onDecide} onOverride={onOverride} canOverride={canOverride} isSubmitting={busy} />
        )}
      </ApprovalSheet>
    </>
  );
}
