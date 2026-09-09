import { useEffect, useMemo } from "react"
import {
    ReactFlow,
    ReactFlowProvider,
    Background,
    BackgroundVariant,
    Controls,
    MarkerType,
    useReactFlow,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"

import FlowCanvasNode from "../settings/FlowCanvasNode"
import FlowBracketNode from "../settings/FlowBracketNode"
import { bracketNode, bracketRuns, STAGE_W, STAGE_H } from "../settings/flowCanvasLayout"
import { entryStage } from "../../constants/salesFlow"

/**
 * Far below React Flow's default floor of 0.5. A Sales Flow is a long chain
 * rather than a compact graph — the Government flow runs to eighteen Stages —
 * and at 0.5 the far end simply sits off-screen with no indication it is there.
 */
const MIN_ZOOM = 0.05

/**
 * A Flow Snapshot, drawn read-only.
 *
 * WHY THIS IS NOT THE FLOW CANVAS
 * The canvas is an editor. It reads its data through `FlowDataContext` and
 * calls a service surface to mutate live rows — the sandbox provider exists
 * precisely because feeding it something else means reimplementing that whole
 * surface. Doing that a third time to render a *frozen* document would couple
 * a read-only context view to every future change in how editing works, for no
 * benefit: a snapshot has nothing to mutate.
 *
 * So this draws the same nodes with the same layout constants, and nothing
 * else. It is deliberately small, and it stays correct as long as the node's
 * data contract holds.
 *
 * `currentStageId` marks where a particular deal is sitting, when the viewer
 * was opened from one. Opened on its own it renders plain.
 */
export default function FlowVersionViewer(props) {
    // The provider is what gives the inner component `useReactFlow`, which is
    // the only reliable way to frame a graph whose nodes are measured after
    // the first paint.
    return (
        <ReactFlowProvider>
            <FlowVersionCanvas {...props} />
        </ReactFlowProvider>
    )
}

function FlowVersionCanvas({ snapshotData, currentStageId = null }) {
    const stages = useMemo(() => snapshotData?.stages ?? [], [snapshotData])
    const edges = useMemo(() => snapshotData?.edges ?? [], [snapshotData])
    const conditions = useMemo(() => snapshotData?.conditions ?? [], [snapshotData])
    const actions = useMemo(() => snapshotData?.actions ?? [], [snapshotData])

    const nodes = useMemo(() => {
        if (stages.length === 0) return []

        const entry = entryStage(stages)
        const wonId = snapshotData?.wonStageId ?? null

        // Brackets are a shared text label rather than a container, so the
        // brace is a synthetic node spanning a consecutive run of Stages that
        // share the label — the same `bracketRuns` rule the canvas and the
        // deal modal's stage control draw, kept identical on purpose so the
        // pictures agree (issue #182).
        const bracketNodes = bracketRuns(stages).filter((run) => run.label).map(bracketNode)

        const stageNodes = stages.map((stage) => ({
            id: stage.id,
            type: "stage",
            position: { x: stage.pos_x ?? 0, y: stage.pos_y ?? 0 },
            // Explicit dimensions so `fitView` can compute the graph's bounds
            // on the first render. Without them React Flow measures the nodes
            // after painting, fits against zero-sized boxes, and leaves a wide
            // flow running off both edges of the screen.
            width: STAGE_W,
            height: STAGE_H,
            draggable: false,
            connectable: false,
            deletable: false,
            selected: currentStageId ? stage.id === currentStageId : false,
            data: {
                stage,
                isEntry: entry?.id === stage.id,
                isWon: wonId === stage.id,
                disabled: false,
                conditionCount: conditions.filter((c) => c.stage_id === stage.id).length,
                actionCount: actions.filter((a) => a.stage_id === stage.id).length,
            },
        }))

        return [...bracketNodes, ...stageNodes]
    }, [stages, conditions, actions, snapshotData, currentStageId])

    const flowEdges = useMemo(
        () =>
            edges.map((edge) => ({
                id: edge.id,
                source: edge.from_stage_id,
                target: edge.to_stage_id,
                sourceHandle: "out",
                targetHandle: "in",
                deletable: false,
                focusable: false,
                markerEnd: { type: MarkerType.ArrowClosed },
            })),
        [edges],
    )

    const nodeTypes = useMemo(() => ({ stage: FlowCanvasNode, bracket: FlowBracketNode }), [])

    // Framing, and why it is not simply "fit everything".
    //
    // A Sales Flow is a long chain, not a compact graph — the Government flow
    // runs to eighteen Stages across nearly seven thousand pixels. Fitting all
    // of it lands at roughly 0.09 zoom, where every Stage is an unreadable grey
    // smudge and the picture answers nothing. So when the viewer is opened from
    // a deal it frames that deal's Stage at a readable size, which is what the
    // reader came for: where am I, and what comes next.
    //
    // Centred from the Stage's own stored coordinates rather than by asking
    // React Flow to fit a node. Fitting depends on the node having been
    // measured, and a viewer that mounts with its data already resolved can
    // paint before that happens — which left the deal's Stage off-screen while
    // the viewport sat at its default. The snapshot already records pos_x and
    // pos_y, so there is nothing to wait for.
    const { setCenter } = useReactFlow()
    useEffect(() => {
        if (!currentStageId) return
        const target = stages.find((s) => s.id === currentStageId)
        if (!target) return
        setCenter(
            (target.pos_x ?? 0) + STAGE_W / 2,
            (target.pos_y ?? 0) + STAGE_H / 2,
            { zoom: 0.75, duration: 250 },
        )
    }, [currentStageId, stages, setCenter])

    if (stages.length === 0) {
        return (
            <div className="flex h-full items-center justify-center p-8 text-center">
                <p className="max-w-sm text-sm text-muted-foreground">
                    This version has no Stages recorded. It was locked before any were drawn.
                </p>
            </div>
        )
    }

    return (
        <ReactFlow
            nodes={nodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            minZoom={MIN_ZOOM}
            fitView={!currentStageId}
            fitViewOptions={{ padding: 0.15, minZoom: MIN_ZOOM }}
            // Every editing affordance off: this is a record of what the rules
            // were, and nothing here can change them.
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            edgesFocusable={false}
            proOptions={{ hideAttribution: true }}
        >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
            <Controls showInteractive={false} />
        </ReactFlow>
    )
}
