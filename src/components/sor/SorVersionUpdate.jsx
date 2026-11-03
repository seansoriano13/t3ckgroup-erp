import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import toast from "react-hot-toast"
import { salesFlowService } from "../../services/salesFlowService"
import { opportunityService } from "../../services/opportunityService"
import { formatSnapshotVersion } from "../../constants/flowVersion"
import { getPermissionContext } from "../../utils/permissions"
import {
    canUpdateSorVersion,
    declineUpdatePrompt,
    hasDeclinedUpdatePrompt,
    isOutdatedSor,
    revertTargets,
} from "../../utils/sorVersionUpdate"
import { useAuth } from "../../context/AuthContext"
import { ChevronDown, Undo2 } from "lucide-react"
import { cn } from "../../lib/utils"
import { Button } from "../ui/button"
import Dropdown from "../ui/Dropdown"
import { FilterOptionList } from "../ui/FilterDropdown"

/**
 * Outdated SORs (#743), on the SOR itself.
 *
 * Opening an Outdated SOR offers the update to the people allowed to do it
 * (Super Admin, or the Deal Team, one SOR at a time). "Not now" is remembered
 * for this session only. A Super Admin can also put the SOR back on an older
 * version that still has its Stage; the database refuses any other. The words
 * are "update", never "move".
 */
export default function SorVersionUpdate({ opportunity }) {
    const { user } = useAuth()
    const queryClient = useQueryClient()
    const [, rerender] = useState(0)

    const saleTypeId = opportunity?.sale_type_id ?? null
    const { isSuperAdmin } = getPermissionContext(user)

    const { data: canvas } = useQuery({
        queryKey: ["salesFlow", saleTypeId],
        queryFn: () => salesFlowService.getFlow(saleTypeId),
        enabled: Boolean(saleTypeId),
    })
    const flowId = canvas?.flow?.id ?? null
    const { data: snapshots = [] } = useQuery({
        queryKey: ["flowSnapshots", flowId],
        queryFn: () => salesFlowService.listSnapshots(flowId),
        enabled: Boolean(flowId),
    })

    const update = useMutation({
        mutationFn: (snapshotId) =>
            opportunityService.updateSorVersions([opportunity.id], snapshotId, { queryClient, actorId: user?.id }),
        onSuccess: ({ failed }) => {
            if (failed.length > 0) {
                toast.error(failed[0].reason)
                return
            }
            toast.success("Version updated.")
            queryClient.invalidateQueries({ queryKey: ["opportunity", opportunity.id] })
            queryClient.invalidateQueries({ queryKey: ["globalOpportunity", opportunity.id] })
            queryClient.invalidateQueries({ queryKey: ["opportunityNotes", opportunity.id] })
        },
        onError: (err) => toast.error(err.message),
    })

    const latest = snapshots[0] ?? null
    const { data: preview } = useQuery({
        queryKey: ["versionUpdatePreview", opportunity?.id, latest?.id],
        queryFn: () => opportunityService.previewVersionUpdate([opportunity.id], latest.id),
        enabled: Boolean(opportunity?.id && latest?.id && opportunity.flow_snapshot_id !== latest.id),
    })
    if (!opportunity?.id || !latest) return null

    const allowed = canUpdateSorVersion({ actor: user, sor: opportunity, batchSize: 1 })
    const outdated = isOutdatedSor(opportunity, latest.id)
    const showPrompt = outdated && allowed && !hasDeclinedUpdatePrompt(opportunity.id)
    const olderTargets = isSuperAdmin ? revertTargets(snapshots, opportunity) : []

    if (!showPrompt && olderTargets.length === 0) return null

    return (
        <div className="flex flex-wrap items-center justify-end gap-2 text-xs">
            {showPrompt && (
                <>
                    <span>{`A newer version, ${formatSnapshotVersion(latest)}, is available for this SOR.`}</span>
                    {(preview?.lines ?? []).map((line) => (
                        <span key={line.id} className="w-full text-right text-mauve-11">
                            {`Updating will run: ${line.text.replace(/^1 deal will get: /, "")}`}
                        </span>
                    ))}
                    <Button size="sm" disabled={update.isPending} onClick={() => update.mutate(latest.id)}>
                        {`Update to ${formatSnapshotVersion(latest)}`}
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                            declineUpdatePrompt(opportunity.id)
                            rerender((n) => n + 1)
                        }}
                    >
                        Not now
                    </Button>
                </>
            )}
            {olderTargets.length > 0 && (
                <Dropdown
                    usePortal
                    placement="bottom-end"
                    matchTriggerWidth={false}
                    disabled={update.isPending}
                    trigger={({ isOpen }) => (
                        <Button
                            size="xs"
                            variant="ghost"
                            aria-haspopup="menu"
                            aria-expanded={isOpen}
                            title="Put this SOR back on an older version of its Sales Flow."
                            className="text-[11px] text-mauve-11"
                        >
                            <Undo2 aria-hidden="true" />
                            Older version
                            <ChevronDown
                                className={cn("transition-transform", isOpen && "rotate-180")}
                                aria-hidden="true"
                            />
                        </Button>
                    )}
                >
                    {({ close }) => (
                        <div aria-label="Put back on an older version">
                            <p className="px-3 pt-2 text-[11px] font-medium text-mauve-10">Put back on</p>
                            <FilterOptionList
                                options={olderTargets.map((s) => ({ value: s.id, label: formatSnapshotVersion(s) }))}
                                value={null}
                                onChange={(snapshotId) => update.mutate(snapshotId)}
                                close={close}
                            />
                        </div>
                    )}
                </Dropdown>
            )}
        </div>
    )
}
