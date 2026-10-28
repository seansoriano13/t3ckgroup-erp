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
import { Button } from "../ui/button"
import { SelectField } from "../ui/SelectField"

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
    const [picking, setPicking] = useState(false)
    const [target, setTarget] = useState("")

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
            opportunityService.updateSorVersions([opportunity.id], snapshotId, { queryClient }),
        onSuccess: ({ failed }) => {
            if (failed.length > 0) {
                toast.error(failed[0].reason)
                return
            }
            toast.success("Version updated.")
            setPicking(false)
            queryClient.invalidateQueries({ queryKey: ["opportunity", opportunity.id] })
            queryClient.invalidateQueries({ queryKey: ["globalOpportunity", opportunity.id] })
            queryClient.invalidateQueries({ queryKey: ["opportunityNotes", opportunity.id] })
        },
        onError: (err) => toast.error(err.message),
    })

    const latest = snapshots[0] ?? null
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
                <>
                    {!picking ? (
                        <Button size="sm" variant="ghost" onClick={() => setPicking(true)}>
                            Put back on an older version
                        </Button>
                    ) : (
                        <>
                            <SelectField
                                aria-label="Older version"
                                size="sm"
                                placeholder="Choose a version"
                                value={target}
                                onChange={setTarget}
                                options={olderTargets.map((s) => ({ value: s.id, label: formatSnapshotVersion(s) }))}
                            />
                            <Button size="sm" disabled={!target || update.isPending} onClick={() => update.mutate(target)}>
                                Put back
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>
                                Cancel
                            </Button>
                        </>
                    )}
                </>
            )}
        </div>
    )
}
