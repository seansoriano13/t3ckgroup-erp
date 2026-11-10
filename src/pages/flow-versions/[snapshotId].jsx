import PageLoading from "@/components/ui/PageLoading";
import { useParams, useSearchParams, Link } from "react-router"
import EmptyState from "@/components/ui/EmptyState";
import QueryError from "@/components/ui/QueryError";
import { formatDateWith } from "@/utils/formatDate"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeft } from "lucide-react"

import { salesFlowService } from "@/services/salesFlowService"
import { formatSnapshotVersion } from "@/constants/flowVersion"
import FlowVersionViewer from "@/components/sor/FlowVersionViewer"
import PageShell from "@/components/ui/PageShell"
import DesktopNotice from "@/components/ui/DesktopNotice";

/**
 * One version of a Sales Flow, read-only.
 *
 * Reached from the version badge on an SOR: a deal is pinned to a Flow
 * Snapshot when it is registered and follows those rules for its whole life,
 * so "what does my flow actually look like" has to be answerable per deal
 * rather than by looking at whatever the canvas currently holds.
 *
 * **Deliberately not under `/super-admin/flow-canvas`.** That page's Snapshot
 * history is Super-Admin only, so a salesperson could never reach it. Reading a
 * snapshot needs neither: `flow_snapshots_read` is `using (true)` for every
 * authenticated employee, which is asserted in the policy tier.
 *
 * `?stage=<id>` marks where a particular deal is sitting, so the picture
 * answers "where am I and what comes next" rather than only "what are the
 * rules".
 */
export default function FlowVersionPage() {
    const { snapshotId } = useParams()
    const [searchParams] = useSearchParams()
    const currentStageId = searchParams.get("stage")

    const {
        data: snapshot,
        isLoading,
        isError,
        refetch,
    } = useQuery({
        queryKey: ["flowSnapshot", snapshotId],
        queryFn: () => salesFlowService.getSnapshot(snapshotId),
        enabled: Boolean(snapshotId),
        staleTime: Infinity, // A snapshot is immutable.
    })

    const published = snapshot?.created_at
        ? `Published ${formatDateWith(snapshot.created_at, {
              year: "numeric",
              month: "short",
              day: "numeric",
          })}`
        : undefined

    return (
        <PageShell
            title={snapshot ? `Sales Flow — ${formatSnapshotVersion(snapshot)}` : "Sales Flow version"}
            description={published}
            frame="full"
            action={
                <>
                    <span className="rounded-full border border-mauve-6 bg-mauve-3 px-2 py-0.5 text-[11px] font-medium text-mauve-11">
                        Read-only
                    </span>
                    <Link
                        to="/sors"
                        className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-mauve-3 hover:text-foreground"
                    >
                        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                        SOR Register
                    </Link>
                </>
            }
        >
            <div className="relative flex h-full flex-col">
                <DesktopNotice className="m-3" />
                {snapshot?.note && (
                    <p className="border-b border-border px-4 py-2 text-sm italic text-muted-foreground">
                        “{snapshot.note}”
                    </p>
                )}

                <div className="min-h-0 flex-1">
                    {isLoading && (
                        <PageLoading label="this version" />
                    )}

                    {isError && (
                        <QueryError className="m-8" title="This version could not be loaded." onRetry={refetch} />
                    )}

                    {!isLoading && !isError && !snapshot && (
                        <EmptyState
                            title="No such Sales Flow version"
                            description="It may belong to a Sale Type that has since been deleted. The deals pinned to it keep their own copy of the rules either way."
                            action={<Link to="/sors" className="text-xs font-semibold text-foreground underline underline-offset-2">Open SOR Register</Link>}
                        />
                    )}

                    {snapshot && (
                        <FlowVersionViewer
                            snapshotData={snapshot.snapshot_data}
                            currentStageId={currentStageId}
                        />
                    )}
                </div>
            </div>
        </PageShell>
    )
}
