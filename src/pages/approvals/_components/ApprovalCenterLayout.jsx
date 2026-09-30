import { Link } from "react-router";
import PageContainer from "../../../components/ui/PageContainer";
import PageHeader from "../../../components/ui/PageHeader";
import { APPROVAL_QUEUES, useApprovalRoles } from "./useApprovalQueues";

/**
 * The frame every Approval Center page shares: the header, and one tab per
 * queue the reviewer may act on (each a route, each with its pending count).
 * The page supplies everything under the tabs.
 */
export function ApprovalCenterLayout({
  queue,
  counts = {},
  headerActions,
  children,
}) {
  const roles = useApprovalRoles();
  const queues = APPROVAL_QUEUES.filter((q) => q.can(roles));

  return (
    <PageContainer maxWidth="full" spaceY="4" className="pt-3 pb-28">
      <div>
        <PageHeader title="Approval Center" className="border-b-0 pb-0">
          {headerActions}
        </PageHeader>

        <nav
          aria-label="Approval queues"
          className="mt-5 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border [scrollbar-width:none]"
        >
          {queues.map((q) => {
            const active = q.key === queue;
            return (
              <Link
                key={q.key}
                to={q.path}
                aria-current={active ? "page" : undefined}
                className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 pb-2.5 pt-1 text-[13px] transition-colors ${
                  active
                    ? "border-mauve-12 font-bold text-foreground"
                    : "border-transparent font-semibold text-muted-foreground hover:text-foreground"
                }`}
              >
                <q.icon size={15} />
                {q.label}
                {counts[q.key] != null && (
                  <span
                    className={`rounded-full px-1.5 py-px font-mono text-[10px] tabular-nums ${active ? "bg-mauve-12 text-mauve-1" : "bg-muted text-muted-foreground"}`}
                  >
                    {counts[q.key]}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {children}
    </PageContainer>
  );
}
