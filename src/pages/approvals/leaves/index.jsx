import { useMemo, useState } from "react";
import QueryError from "@/components/ui/QueryError";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Clock, Layers, SlidersHorizontal, X } from "lucide-react";
import toast from "react-hot-toast";
import { decideHeadApproval } from "../../../services/headApprovalService";
import ProtectedRoute from "../../../components/ProtectedRoute";
import Spinner from "@/components/ui/Spinner";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/Tooltip";
import { leaveToItem } from "../../../utils/approvalItems.js";
import { useRecordParam } from "../../../hooks/useRecordParam";
import { APPROVAL_QUEUES, useApprovalQueues } from "../_components/useApprovalQueues";
import { ApprovalCenterLayout } from "../_components/ApprovalCenterLayout";
import { ApprovalToolbar, PillFilter } from "../_components/ApprovalToolbar";
import { ApprovalTable } from "../_components/ApprovalTable";
import { ApprovalSheet } from "../_components/ApprovalSheet";
import { LeaveReview } from "../_components/LeaveReview";

const QUEUE = APPROVAL_QUEUES.find((q) => q.key === "leaves");

/**
 * Leave & Overtime — the department-head stage (issue #137) in the Approval
 * Center: every SIL, Offset, overtime and undertime request routed to the
 * signed-in head and still waiting on their decision before HR can act on it.
 */
export default function LeaveApprovalsPage() {
  return (
    <ProtectedRoute requireHead>
      <LeaveApprovalsQueue />
    </ProtectedRoute>
  );
}

function LeaveApprovalsQueue() {
  const queryClient = useQueryClient();
  const q = useApprovalQueues();
  const { user } = q.roles;

  const [view, setView] = useState("ALL");
  const { recordId, open: openRecord, step: stepRecord, close: closeRecord } = useRecordParam();
  const [search, setSearch] = useState("");
  const [person, setPerson] = useState("ALL");
  const [type, setType] = useState("ALL");

  const all = useMemo(() => q.leavesPending.map((r) => leaveToItem(r)).sort((a, b) => new Date(a.clockAt) - new Date(b.clockAt)), [q.leavesPending]);
  const stale = all.filter((i) => i.isStale);
  const active = all.filter((i) => !i.isStale);
  const source = view === "STALE" ? stale : view === "ACTIVE" ? active : all;

  const people = useMemo(() => {
    const m = new Map();
    for (const i of source) m.set(i.person.id, { id: i.person.id, name: i.person.name, count: (m.get(i.person.id)?.count || 0) + 1 });
    return [...m.values()].sort((a, b) => b.count - a.count);
  }, [source]);
  const types = [...new Set(source.map((i) => i.typeLabel))];

  const needle = search.trim().toLowerCase();
  const items = source.filter(
    (i) =>
      (person === "ALL" || i.person.id === person) &&
      (type === "ALL" || i.typeLabel === type) &&
      (!needle || [i.person.name, i.typeLabel, i.source.reason, i.ref].some((f) => (f || "").toLowerCase().includes(needle))),
  );

  const index = items.findIndex((i) => String(i.id) === recordId);
  const open = index >= 0 ? items[index] : null;

  const decide = useMutation({
    mutationFn: ({ item, status, note }) =>
      decideHeadApproval({
        table: item.source.table,
        matchColumn: item.source.matchColumn,
        matchValue: item.source.matchValue,
        headId: user.id,
        status,
        headNote: note || "",
      }),
    onSuccess: (_data, { status }) => {
      toast.success(status === "APPROVED" ? "Approved." : "Declined.");
      queryClient.invalidateQueries({ queryKey: ["headPendingApprovals"] });
      queryClient.invalidateQueries({ queryKey: ["navHeadPendingApprovals"] });
    },
    onError: (err) => toast.error(err.message || "Could not record the decision."),
  });

  const onDecide = (item, status, note) => {
    const at = items.findIndex((i) => i.id === item.id);
    const next = items[at + 1] || items[at - 1];
    decide.mutate({ item, status, note }, { onSuccess: () => { if (String(item.id) !== recordId) return; if (next) stepRecord(next.id); else closeRecord(); } });
  };

  if (q.isErrorLeaves) {
    return <QueryError className="m-6" title="Leave & overtime requests could not be loaded." onRetry={q.refetchLeaves} />;
  }

  if (q.isLoadingLeaves) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="md" />
      </div>
    );
  }

  return (
    <>
      <ApprovalCenterLayout
        toolbar={
        <ApprovalToolbar
          views={[
            { value: "ALL", label: "All Pending", icon: Layers, badge: all.length || undefined },
            { value: "ACTIVE", label: "Active (<48h)", icon: Clock, badge: active.length || undefined },
            { value: "STALE", label: "Stale Backlog (>48h)", icon: AlertTriangle, badge: stale.length || undefined },
          ]}
          view={view}
          onViewChange={(v) => {
            setView(v);
            setPerson("ALL");
          }}
          people={people}
          person={person}
          onPersonChange={setPerson}
          personLabel="Requested by"
          extraFilters={
            types.length > 1 && (
              <PillFilter
                label="Type"
                icon={<SlidersHorizontal size={13} className="text-muted-foreground" />}
                value={type}
                options={[{ value: "ALL", label: "Any type" }, ...types.map((t) => ({ value: t, label: t }))]}
                onChange={setType}
              />
            )
          }
          search={search}
          onSearchChange={setSearch}
        />}
      >

        <ApprovalTable
          items={items}
          queueIcon={QUEUE.icon}
          personLabel="Requested by"
          onOpen={(item) => openRecord(item.id)}
          searchTerm={search}
          keyboard={!open}
          renderRowAction={(item) => (
            <>
              <Tooltip content="Decline">
                <Button variant="outline" size="icon-sm" aria-label={`Decline ${item.person.name}'s ${item.typeLabel}`} disabled={decide.isPending} onClick={() => onDecide(item, "REJECTED", "")}>
                  <X size={14} />
                </Button>
              </Tooltip>
              <Tooltip content="Approve">
                <Button
                  variant="outline"
                  size="icon-sm"
                  aria-label={`Approve ${item.person.name}'s ${item.typeLabel}`}
                  disabled={decide.isPending}
                  className="hover:border-green-7 hover:bg-green-3 hover:text-green-11"
                  onClick={() => onDecide(item, "APPROVED", "")}
                >
                  <Check size={14} />
                </Button>
              </Tooltip>
            </>
          )}
          empty={{ title: "Nothing waiting on you right now.", description: "Leave, Offset and overtime requests routed to you as department head show up here." }}
        />
      </ApprovalCenterLayout>

      <ApprovalSheet
        item={open}
        queueLabel={QUEUE.label}
        queueIcon={QUEUE.icon}
        index={index}
        total={items.length}
        onStep={(d) => { const to = items[index + d]; if (to) stepRecord(to.id); }}
        onClose={closeRecord}
      >
        {(item) => <LeaveReview key={item.id} item={item} onDecide={onDecide} isSubmitting={decide.isPending} />}
      </ApprovalSheet>
    </>
  );
}
