import { useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { PackageCheck } from "lucide-react";
import PageLoading from "@/components/ui/PageLoading";
import QueryError from "@/components/ui/QueryError";
import ProtectedRoute from "../../../components/ProtectedRoute";
import { transmittalService } from "../../../services/transmittalService";
import { TRANSMITTAL_STATE } from "../../../constants/transmittals";
import { transmittalToItem } from "../../../utils/approvalItems.js";
import { APPROVAL_QUEUES, useApprovalRoles } from "../_components/useApprovalQueues";
import { ApprovalCenterLayout } from "../_components/ApprovalCenterLayout";
import { ApprovalToolbar } from "../_components/ApprovalToolbar";
import { ApprovalTable } from "../_components/ApprovalTable";

const QUEUE = APPROVAL_QUEUES.find((q) => q.key === "transmittals");

/**
 * Transmittal Check by (#254, spec #251) in the Approval Center: every TG03
 * slip that has passed its stages and waits for Check by, for the people on the
 * Check by list. Opening a row goes to the slip, where its two Check by plates
 * are signed. Only Check by list members see this queue.
 */
export default function TransmittalCheckByPage() {
  return (
    <ProtectedRoute>
      <TransmittalCheckByQueue />
    </ProtectedRoute>
  );
}

function TransmittalCheckByQueue() {
  const navigate = useNavigate();
  const { user, isTransmittalCheckBy, isTransmittalListsLoading } = useApprovalRoles();
  const [search, setSearch] = useState("");

  const slipsQuery = useQuery({
    queryKey: ["transmittalCheckByQueue", user?.id],
    queryFn: () => transmittalService.list({ state: TRANSMITTAL_STATE.AWAITING_CHECK }),
    enabled: !!user?.id && isTransmittalCheckBy,
  });

  const all = useMemo(() => (slipsQuery.data || []).map((slip) => transmittalToItem(slip)), [slipsQuery.data]);
  const needle = search.trim().toLowerCase();
  const items = all.filter(
    (i) =>
      !needle ||
      [i.ref, i.title, i.typeLabel, i.person.name].some((f) => (f || "").toLowerCase().includes(needle)),
  );

  if (isTransmittalListsLoading) return <PageLoading label="Transmittal Check by" />;
  if (!isTransmittalCheckBy) return <Navigate to="/approvals" replace />;

  if (slipsQuery.isError) {
    return (
      <QueryError className="m-6" title="Transmittal Check by could not be loaded." onRetry={slipsQuery.refetch} />
    );
  }
  if (slipsQuery.isLoading) return <PageLoading label="Transmittal Check by" />;

  return (
    <ApprovalCenterLayout
      toolbar={
        <ApprovalToolbar
          views={[{ value: "ALL", label: "Awaiting Check by", icon: QUEUE.icon, badge: all.length || undefined }]}
          view="ALL"
          onViewChange={() => {}}
          people={[]}
          person="ALL"
          onPersonChange={() => {}}
          personLabel="Prepared by"
          search={search}
          onSearchChange={setSearch}
        />
      }
    >
      <ApprovalTable
        items={items}
        filtered={all.length > 0}
        onClearFilters={() => setSearch("")}
        queueIcon={PackageCheck}
        personLabel="Prepared by"
        onOpen={(item) => navigate(`/purchasing/transmittals/${item.id}`)}
        searchTerm={search}
        empty={{
          title: "No Transmittal is waiting for Check by",
          description: "Slips that pass their warehouse and technical stages show up here until both Check by plates are signed.",
        }}
      />
    </ApprovalCenterLayout>
  );
}
