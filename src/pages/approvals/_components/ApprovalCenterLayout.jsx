import { useNavigate } from "react-router";
import PageShell from "../../../components/ui/PageShell";
import TabGroup from "../../../components/ui/TabGroup";
import { APPROVAL_QUEUES, useApprovalRoles } from "./useApprovalQueues";

/**
 * The Queue Page frame every Approval Center route shares, on PageShell: the
 * header, one level-1 tab per queue the reviewer may act on (each a route, each
 * with its pending count), then the page's `toolbar` (level-2 views + filter
 * bar) and body. The bottom padding clears the selection bar.
 */
export function ApprovalCenterLayout({ queue, counts = {}, headerActions, toolbar, children }) {
  const roles = useApprovalRoles();
  const navigate = useNavigate();
  const queues = APPROVAL_QUEUES.filter((q) => q.can(roles));

  return (
    <PageShell
      title="Approval Center"
      action={headerActions}
      className="pb-28"
      tabs={
        <TabGroup
          variant="underline"
          size="sm"
          tabs={queues.map((q) => ({ value: q.key, label: q.label, icon: q.icon, badge: counts[q.key] }))}
          activeTab={queue}
          onChange={(key) => navigate(queues.find((q) => q.key === key).path)}
        />
      }
      toolbar={toolbar}
    >
      {children}
    </PageShell>
  );
}
