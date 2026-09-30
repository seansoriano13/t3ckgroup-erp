import PageShell from "../../../components/ui/PageShell";

/**
 * The Queue Page frame every Approval Center route shares, on PageShell: the
 * header, then the page's `toolbar` (level-2 views + filter bar) and body. The
 * sidebar already links each queue, so there is no level-1 tab strip here. The
 * bottom padding clears the selection bar.
 */
export function ApprovalCenterLayout({ headerActions, toolbar, children }) {
  return (
    <PageShell title="Approval Center" action={headerActions} className="pb-28" toolbar={toolbar}>
      {children}
    </PageShell>
  );
}
