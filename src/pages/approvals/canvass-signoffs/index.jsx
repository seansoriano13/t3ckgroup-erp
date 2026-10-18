import { useMemo, useState } from "react";
import { Navigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Scale } from "lucide-react";
import PageLoading from "@/components/ui/PageLoading";
import QueryError from "@/components/ui/QueryError";
import CanvassSignoffDialog from "@/components/CanvassSignoffDialog";
import ProtectedRoute from "../../../components/ProtectedRoute";
import { canvassService } from "../../../services/canvassService";
import { canvassSignoffToItem } from "../../../utils/approvalItems.js";
import { APPROVAL_QUEUES, useApprovalRoles } from "../_components/useApprovalQueues";
import { ApprovalCenterLayout } from "../_components/ApprovalCenterLayout";
import { ApprovalToolbar } from "../_components/ApprovalToolbar";
import { ApprovalTable } from "../_components/ApprovalTable";

const QUEUE = APPROVAL_QUEUES.find((q) => q.key === "canvass");

const canvassQueueKey = (userId) => ["canvassSignoffQueue", userId];

/**
 * Canvass sign-offs (#279, spec #275) in the Approval Center: every Canvass with a winner and a
 * reason that nobody has signed, for the purchasing approver list (the list that approves
 * Transmittals). Not the Canvasses the person opened themselves. Opening a row shows the winner and
 * the reason, warns under three Offers, and signs; the database decides who may. A Canvass changed
 * after signing comes back here.
 */
export default function CanvassSignoffsPage() {
  return (
    <ProtectedRoute>
      <CanvassSignoffsQueue />
    </ProtectedRoute>
  );
}

function CanvassSignoffsQueue() {
  const queryClient = useQueryClient();
  const { user, isCanvassApprover, isTransmittalListsLoading } = useApprovalRoles();
  const [search, setSearch] = useState("");
  const [signing, setSigning] = useState(null);

  const pendingQuery = useQuery({
    queryKey: canvassQueueKey(user?.id),
    queryFn: () => canvassService.pendingSignoffs(),
    enabled: !!user?.id && isCanvassApprover,
  });

  const all = useMemo(() => (pendingQuery.data || []).map((pending) => canvassSignoffToItem(pending)), [pendingQuery.data]);
  const needle = search.trim().toLowerCase();
  const items = all.filter(
    (i) => !needle || [i.ref, i.title, i.typeLabel, i.person.name, i.person.dept].some((f) => (f || "").toLowerCase().includes(needle)),
  );

  if (isTransmittalListsLoading) return <PageLoading label="Canvass Sign-offs" />;
  if (!isCanvassApprover) return <Navigate to="/approvals" replace />;

  if (pendingQuery.isError) {
    return <QueryError className="m-6" title="Canvass Sign-offs could not be loaded." onRetry={pendingQuery.refetch} />;
  }
  if (pendingQuery.isLoading) return <PageLoading label="Canvass Sign-offs" />;

  const summary = signing
    ? {
        id: signing.canvassId,
        number: signing.number,
        subjectLabel: [signing.subjectName, signing.projectTitle].filter(Boolean).join(" · "),
        reason: signing.reason,
        offerCount: signing.offerCount,
        winnerLabel: [signing.winnerSupplier, signing.winnerBrand].filter(Boolean).join(" · "),
      }
    : null;

  return (
    <ApprovalCenterLayout
      toolbar={
        <ApprovalToolbar
          views={[{ value: "ALL", label: "Waiting for sign-off", icon: QUEUE.icon, badge: all.length || undefined }]}
          view="ALL"
          onViewChange={() => {}}
          people={[]}
          person="ALL"
          onPersonChange={() => {}}
          personLabel="Canvassed by"
          search={search}
          onSearchChange={setSearch}
        />
      }
    >
      <ApprovalTable
        items={items}
        filtered={all.length > 0}
        onClearFilters={() => setSearch("")}
        queueIcon={Scale}
        personLabel="Canvassed by"
        onOpen={(item) => setSigning(item.source)}
        searchTerm={search}
        empty={{
          title: "No Canvass is waiting for sign-off",
          description: "A Canvass shows up here once it has a winner and a reason, until someone on the purchasing approver list signs it. A change to a signed Canvass brings it back.",
        }}
      />

      {summary && (
        <CanvassSignoffDialog
          open
          onOpenChange={(next) => !next && setSigning(null)}
          summary={summary}
          onSigned={() => queryClient.invalidateQueries({ queryKey: ["canvassSignoffQueue"] })}
        />
      )}
    </ApprovalCenterLayout>
  );
}
