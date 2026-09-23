import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowUpCircle, ChevronRight, Flag, ListTodo, Octagon, Settings2, Tag, Wand2, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import TabGroup from "@/components/ui/TabGroup"
import { employeeService } from "@/services/employeeService"
import StageActionDetail from "@/components/settings/StageActionDetail"
import {
  ACTION_KIND_META,
  CONDITION_KIND_META,
  actionSummary,
  actionTitle,
  conditionDetail,
} from "@/components/settings/flowStageKinds"

/**
 * One Stage of a Flow Snapshot, opened beside the version viewer, read-only.
 *
 * WHY NOT `StageSettingsPanel`
 * That panel is an editor: every list it shows is a live React Query against
 * `stageConditionService` / `stageActionService`, and every row carries
 * reorder and archive controls wired to mutations. A frozen version has
 * nothing to query and nothing to mutate — its Conditions and Actions are
 * already sitting in the snapshot the viewer was handed. So this draws the
 * same rows, from that data, with no controls, and stays small.
 *
 * `conditions` and `actions` arrive already narrowed to this Stage (see
 * `conditionsForSnapshotStage` / `actionsForSnapshotStage`, which also flatten
 * the older per-Stage-keyed snapshot shape). `versionHasNoRules` is true when
 * the whole snapshot saved no Conditions and no Actions on any Stage — the
 * Government v1 case — and turns the empty tabs into one plain statement
 * rather than three separate "nothing here" cards.
 */
export default function FlowVersionStagePanel({
  stage,
  isEntry = false,
  isWon = false,
  conditions = [],
  actions = [],
  versionHasNoRules = false,
  activeTab,
  onTabChange,
  onClose,
}) {
  const [expandedActionId, setExpandedActionId] = useState(null)
  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => employeeService.getAllEmployees(),
  })

  if (!stage) return null

  // `activeTab` / `onTabChange` are driven by the viewer, which is what knows
  // which tab a click meant — the same arrangement the editor's
  // `StageSettingsPanel` uses.
  const tab = activeTab

  const tabs = [
    { value: "settings", label: "General", icon: Settings2 },
    { value: "conditions", label: "Conditions", icon: ListTodo },
    { value: "actions", label: "Actions", icon: Wand2 },
  ]

  const roles = [
    isEntry && { icon: ArrowUpCircle, label: "Deals enter here", tone: "text-blue-11 bg-blue-a3" },
    isWon && { icon: Flag, label: "Deals are won here", tone: "text-green-11 bg-green-a3" },
    stage.is_terminal && {
      icon: Octagon,
      label: "Deals end here",
      tone: "text-amber-11 bg-amber-a3",
    },
  ].filter(Boolean)

  return (
    <aside
      className={cn(
        "absolute inset-y-0 right-0 z-30 flex w-[26rem] max-w-[92vw] flex-col bg-card",
        "shadow-[-1px_0_0_var(--mauve-6),-24px_0_48px_-32px_rgba(0,0,0,0.5)]",
        "animate-in slide-in-from-right-4 fade-in-0 duration-200 ease-out",
      )}
    >
      <header className="flex items-start gap-3 border-b border-mauve-5 px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
            Stage · this version
          </p>
          <h2 className="mt-0.5 truncate text-lg font-bold tracking-[-0.015em] text-foreground">
            {stage.name}
          </h2>
          {stage.bracket_label && (
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Tag size={11} /> {stage.bracket_label}
            </p>
          )}
        </div>

        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close Stage panel">
          <X />
        </Button>
      </header>

      <div className="border-b border-mauve-5 px-4 py-3">
        <TabGroup
          tabs={tabs}
          activeTab={tab}
          onChange={onTabChange}
          variant="pill"
          size="sm"
          fullWidth
        />
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto overflow-x-hidden">
        {tab === "settings" && (
          <div className="space-y-5 p-5">
            {roles.length > 0 ? (
              <section className="space-y-2.5">
                <h3 className="text-[10px] font-black uppercase tracking-[0.18em] text-muted-foreground">
                  Role in the flow
                </h3>
                <div className="flex flex-wrap gap-2">
                  {roles.map((role) => (
                    <span
                      key={role.label}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold",
                        role.tone,
                      )}
                    >
                      <role.icon size={13} /> {role.label}
                    </span>
                  ))}
                </div>
              </section>
            ) : (
              <p className="text-xs leading-relaxed text-muted-foreground">
                An ordinary Stage — a deal leaves it along the moves drawn on the canvas.
              </p>
            )}

            <p className="text-xs leading-relaxed text-muted-foreground">
              This is how the Stage was recorded when this version was locked. Nothing here can
              be changed — the live flow is edited on the Flow Canvas.
            </p>
          </div>
        )}

        {tab === "conditions" && (
          <RuleList
            rows={conditions}
            versionHasNoRules={versionHasNoRules}
            emptyStage="This version saved no Stage Conditions on this Stage."
            renderRow={(row) => {
              const meta = CONDITION_KIND_META[row.kind]
              const detail = conditionDetail(row)
              const Icon = meta?.icon ?? ListTodo
              return (
                <RuleRow
                  key={row.id ?? `${row.kind}-${row.label}`}
                  Icon={Icon}
                  tone="gate"
                  title={row.label}
                  tag={row.is_required === false ? "Optional" : null}
                  subtitle={
                    <>
                      {meta?.label ?? row.kind}
                      {detail && <span className="text-mauve-10"> · {detail}</span>}
                    </>
                  }
                />
              )
            }}
          />
        )}

        {tab === "actions" && (
          <RuleList
            rows={actions}
            versionHasNoRules={versionHasNoRules}
            emptyStage="This version saved no Stage Actions on this Stage."
            renderRow={(row) => {
              const key = row.id ?? `${row.kind}-${actionTitle(row)}`
              const Icon = ACTION_KIND_META[row.kind]?.icon ?? Wand2
              const isExpanded = expandedActionId === key
              return (
                <div
                  key={key}
                  className="rounded-xl bg-card outline outline-1 -outline-offset-1 outline-mauve-6"
                >
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setExpandedActionId(isExpanded ? null : key)}
                    aria-expanded={isExpanded}
                    className="h-auto w-full justify-start gap-3 rounded-xl px-3 py-2.5 text-left outline-none"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-violet-a3 text-violet-11">
                      <Icon size={15} strokeWidth={2.5} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-foreground">
                        {actionTitle(row)}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {actionSummary(row)}
                      </span>
                    </span>
                    <ChevronRight
                      size={15}
                      className={cn(
                        "shrink-0 text-muted-foreground transition-transform duration-200",
                        isExpanded && "rotate-90",
                      )}
                    />
                  </Button>
                  {isExpanded && <StageActionDetail action={row} employees={employees} />}
                </div>
              )
            }}
          />
        )}
      </div>
    </aside>
  )
}

function RuleList({ rows, renderRow, emptyStage, versionHasNoRules }) {
  if (rows.length === 0) {
    return (
      <div className="p-5">
        <div className="rounded-2xl border border-dashed border-mauve-7 px-5 py-8 text-center">
          <p className="text-sm font-semibold text-foreground">
            {versionHasNoRules
              ? "This version saved no Stage Conditions or Stage Actions"
              : "Nothing recorded here"}
          </p>
          <p className="mx-auto mt-1 text-xs leading-relaxed text-muted-foreground">
            {versionHasNoRules
              ? "It was locked before any were drawn on the flow."
              : emptyStage}
          </p>
        </div>
      </div>
    )
  }

  return <div className="space-y-2 p-5">{rows.map(renderRow)}</div>
}

// Matches the canvas satellites' own gate=amber/run=violet convention
// (FlowSatelliteNode's TONE) so a Stage's rules read the same color whether
// they're seen as cards on the canvas or rows in this panel.
const ROW_TONE = {
  gate: "bg-amber-a3 text-amber-11",
  run: "bg-violet-a3 text-violet-11",
}

function RuleRow({ Icon, title, subtitle, tag, tone = "gate" }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-card px-3 py-2.5 outline outline-1 -outline-offset-1 outline-mauve-6">
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", ROW_TONE[tone])}>
        <Icon size={15} strokeWidth={2.5} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-bold text-foreground">{title}</p>
          {tag && (
            <span className="shrink-0 rounded bg-mauve-a3 px-1.5 py-px text-[9px] font-black uppercase tracking-[0.1em] text-mauve-11">
              {tag}
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  )
}
