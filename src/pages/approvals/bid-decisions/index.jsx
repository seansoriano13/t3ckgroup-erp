import { useMemo, useState } from "react";
import { Navigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Gavel } from "lucide-react";
import PageLoading from "@/components/ui/PageLoading";
import QueryError from "@/components/ui/QueryError";
import ProtectedRoute from "../../../components/ProtectedRoute";
import { costingMatrixService } from "../../../services/costingMatrixService";
import { bidDecisionToItem } from "../../../utils/approvalItems.js";
import { APPROVAL_QUEUES, useApprovalRoles } from "../_components/useApprovalQueues";
import { ApprovalCenterLayout } from "../_components/ApprovalCenterLayout";
import { ApprovalToolbar } from "../_components/ApprovalToolbar";
import { ApprovalTable } from "../_components/ApprovalTable";

const QUEUE = APPROVAL_QUEUES.find((q) => q.key === "bidDecisions");

const bidDecisionQueueKey = (userId) => ["bidDecisionQueue", userId];

/**
 * Bid Decisions (#320, spec #266) in the Approval Center: every Costing Matrix whose Tender Lines
 * all have a Final Offer and that has no live Bid Decision, for the Final Acquire list and Super
 * Admins. The decision (Go, No-go or Revise, with a reason) is taken on the Costing Matrix, at the
 * summary, where the figures are; opening a row goes to the SOR. A decision that a later Final
 * Offer or Final Acquire change cleared comes back here.
 */
export default function BidDecisionsPage() {
  return (
    <ProtectedRoute>
      <BidDecisionsQueue />
    </ProtectedRoute>
  );
}

function BidDecisionsQueue() {
  const { user, isBidDecider } = useApprovalRoles();
  const [search, setSearch] = useState("");

  const pendingQuery = useQuery({
    queryKey: bidDecisionQueueKey(user?.id),
    queryFn: () => costingMatrixService.pendingBidDecisions(),
    enabled: !!user?.id && isBidDecider,
  });

  const all = useMemo(() => (pendingQuery.data || []).map((pending) => bidDecisionToItem(pending)), [pendingQuery.data]);
  const needle = search.trim().toLowerCase();
  const items = all.filter(
    (i) => !needle || [i.ref, i.title, i.typeLabel, i.person.name, i.person.dept].some((f) => (f || "").toLowerCase().includes(needle)),
  );

  if (!isBidDecider) return <Navigate to="/approvals" replace />;

  if (pendingQuery.isError) {
    return <QueryError className="m-6" title="Bid Decisions could not be loaded." onRetry={pendingQuery.refetch} />;
  }
  if (pendingQuery.isLoading) return <PageLoading label="Bid Decisions" />;

  return (
    <ApprovalCenterLayout
      toolbar={
        <ApprovalToolbar
          views={[{ value: "ALL", label: "Waiting for a decision", icon: QUEUE.icon, badge: all.length || undefined }]}
          view="ALL"
          onViewChange={() => {}}
          people={[]}
          person="ALL"
          onPersonChange={() => {}}
          personLabel="Deal Owner"
          search={search}
          onSearchChange={setSearch}
        />
      }
    >
      <ApprovalTable
        items={items}
        filtered={all.length > 0}
        onClearFilters={() => setSearch("")}
        queueIcon={Gavel}
        personLabel="Deal Owner"
        onOpen={(item) =>
          window.dispatchEvent(
            new CustomEvent("OPEN_ENTITY_DETAILS", { detail: { id: item.source.opportunityId, type: "OPPORTUNITY" } }),
          )
        }
        searchTerm={search}
        empty={{
          title: "No bid is waiting for a decision",
          description: "An S0 Evaluation shows up here once every Tender Line has a Final Offer, until the Final Acquire list or a Super Admin decides Go, No-go or Revise.",
        }}
      />
    </ApprovalCenterLayout>
  );
}
