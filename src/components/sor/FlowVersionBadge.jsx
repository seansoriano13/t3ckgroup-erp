import { useQuery } from "@tanstack/react-query"
import { History } from "lucide-react"
import { salesFlowService } from "../../services/salesFlowService"
import { describeFlowVersion } from "../../constants/flowVersion"
import { cn } from "../../lib/utils"

/**
 * Which version of its Sales Flow this SOR is running.
 *
 * An SOR pins `flow_snapshot_id` when it is registered and stays on that
 * version for its whole life, while the flow carries on being edited and
 * locked into later versions (ADR 0006, issue #83). Two people looking at two
 * deals of the same Sale Type can therefore be looking at two different sets
 * of rules, and until now nothing on the record said so.
 *
 * Worth knowing while reading this: the stage control beside it draws the
 * **live** flow, not the pinned version, so where the two disagree this badge
 * is the honest one.
 */
export default function FlowVersionBadge({ opportunity, onOpenVersion = null, className }) {
    const snapshotId = opportunity?.flow_snapshot_id ?? null
    const saleTypeId = opportunity?.sale_type_id ?? null

    const { data: snapshot } = useQuery({
        queryKey: ["flowSnapshot", snapshotId],
        queryFn: () => salesFlowService.getSnapshot(snapshotId),
        enabled: Boolean(snapshotId),
        staleTime: Infinity, // A snapshot is immutable; refetching one is waste.
    })

    // Same key the stage control uses, so the two share one fetch.
    const { data: canvas } = useQuery({
        queryKey: ["salesFlow", saleTypeId],
        queryFn: () => salesFlowService.getFlow(saleTypeId),
        enabled: Boolean(saleTypeId),
    })

    const version = describeFlowVersion({
        opportunity,
        snapshot: snapshot ?? null,
        saleTypeName: canvas?.saleType?.name ?? null,
    })

    // A deal on the legacy pipeline has no version to report and no flow to
    // look at. Saying "Pipeline stages" here would label the chevron ribbon
    // with something nobody asked about.
    if (version.kind === "legacy") return null

    const openable = version.canOpen && typeof onOpenVersion === "function"
    const Tag = openable ? "button" : "span"

    return (
        <Tag
            type={openable ? "button" : undefined}
            onClick={openable ? () => onOpenVersion(version.snapshotId) : undefined}
            title={
                version.kind === "pinned"
                    ? `This deal follows version ${version.version} of its Sales Flow, pinned when it was registered.${
                          openable ? " Open it to see the flow as it stood." : ""
                      }`
                    : "This deal runs a Sales Flow but carries no version on record."
            }
            className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5",
                "text-[11px] font-medium tracking-wide",
                version.kind === "unpinned"
                    ? "border-red-6 bg-red-3 text-red-11"
                    : "border-mauve-6 bg-mauve-3 text-mauve-11",
                openable &&
                    "cursor-pointer transition-colors hover:border-mauve-8 hover:bg-mauve-4 hover:text-mauve-12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mauve-8",
                className,
            )}
        >
            <History className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span>{version.label}</span>
        </Tag>
    )
}
