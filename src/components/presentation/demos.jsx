import { useState } from "react"
import BeforeAfter, { Chrome } from "./BeforeAfter"

/**
 * The six before/after demos.
 *
 * Every "before" panel is a replica built from the source at 9655097 — the
 * commit this presentation starts from — not the old component kept alive.
 * Each reproduces exactly the one interaction being shown and nothing else.
 */

const cardClass =
  "rounded-lg border border-border bg-card px-3 py-2 text-[13px] font-medium text-foreground"

function Row({ children, muted }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 border-b border-border py-2 text-[14px] last:border-0 ${
        muted ? "text-muted-foreground" : "text-foreground"
      }`}
    >
      {children}
    </div>
  )
}

/* ── 1. Flow Canvas versioning (#187, #188, #192, #193) ─────────────────── */

export function FlowVersioningDemo() {
  const [publishedOld, setPublishedOld] = useState(false)
  const [viewing, setViewing] = useState("draft")

  const versions = [
    { id: "draft", label: "Draft", note: "Editing" },
    { id: "v1.2", label: "v1.2", note: "Added Technical Review" },
    { id: "v1.1", label: "v1.1", note: "Renamed Bidding" },
    { id: "v1.0", label: "v1.0", note: "First publish" },
  ]

  return (
    <BeforeAfter
      liveHref="/super-admin/flow-canvas"
      note="The revert keeps the Stage ids, so SORs sitting on those Stages stay attached to their own history."
      before={
        <Chrome title="Flow Canvas">
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setPublishedOld(true)}
              className="rounded-lg border border-border bg-muted px-3 py-2 text-[13px] font-semibold"
            >
              Publish
            </button>
            {publishedOld ? (
              <p className="rounded-lg bg-red-500/10 px-3 py-2 text-[13px] font-semibold text-red-700 dark:text-red-300">
                Published. The previous rules are gone — changing your mind means
                re-creating the Stages by hand.
              </p>
            ) : (
              <p className="text-[13px] text-muted-foreground">
                No history. No version number. No way back.
              </p>
            )}
          </div>
        </Chrome>
      }
      after={
        <Chrome title="Flow Canvas · Government">
          <div className="flex gap-3">
            <div className="w-36 shrink-0 space-y-1">
              {versions.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setViewing(v.id)}
                  className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] font-semibold transition-colors ${
                    viewing === v.id
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/60"
                  }`}
                >
                  {v.label}
                  {v.note === "Editing" && (
                    <span className="ml-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                      Editing
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              {viewing === "draft" ? (
                <p className="text-[13px] text-muted-foreground">
                  Editing the draft. Publishing asks for a note and shows what changed.
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[13px] font-semibold text-amber-800 dark:text-amber-200">
                    Viewing {viewing} — read only. {versions.find((v) => v.id === viewing)?.note}.
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setViewing("draft")}
                      className="rounded-lg border border-border px-3 py-1.5 text-[13px] font-semibold"
                    >
                      ← Back to draft
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-border bg-muted px-3 py-1.5 text-[13px] font-semibold"
                    >
                      Revert to this version
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </Chrome>
      }
    />
  )
}

/* ── 2. CRM board (#206, #286, #288) ────────────────────────────────────── */

const BOARD_SORS = [
  { id: "S07971", name: "DOH — stretchers", type: "Government" },
  { id: "S07983", name: "Ateneo — lab fit-out", type: "Government" },
  { id: "S07990", name: "Sysmex — reagents", type: "Private" },
  { id: "S08001", name: "Walk-in — spare parts", type: "Retail" },
]

export function CrmBoardDemo() {
  const [placed, setPlaced] = useState(BOARD_SORS)
  const [dragging, setDragging] = useState(null)
  const [refused, setRefused] = useState(false)

  const saleTypes = ["Government", "Private", "Retail"]
  const oldStages = ["Registered", "Bidding", "Awarded"]

  function drop(type) {
    if (!dragging) return
    setPlaced((prev) => prev.map((s) => (s.id === dragging ? { ...s, type } : s)))
    setDragging(null)
  }

  return (
    <BeforeAfter
      liveHref="/crm"
      note="Dragging was switched off on purpose: the Closed Lost reason was enforced inside the modal, so a drag could not ask for it. Moving the guard into the move is what made the board draggable."
      before={
        <Chrome title="Opportunities · Board">
          <div className="grid grid-cols-3 gap-2">
            {oldStages.map((stage) => (
              <div key={stage} className="space-y-1.5">
                <p className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
                  {stage}
                </p>
                {BOARD_SORS.slice(0, stage === "Registered" ? 2 : 1).map((s) => (
                  <button
                    key={`${stage}-${s.id}`}
                    type="button"
                    onClick={() => setRefused(true)}
                    className={`${cardClass} block w-full cursor-not-allowed text-left`}
                  >
                    {s.id}
                  </button>
                ))}
              </div>
            ))}
          </div>
          {refused && (
            <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[13px] font-semibold text-red-700 dark:text-red-300">
              Move it from the SOR. Dragging cannot ask for a Closed Lost reason.
            </p>
          )}
        </Chrome>
      }
      after={
        <Chrome title="CRM · Board">
          <div className="grid grid-cols-3 gap-2">
            {saleTypes.map((type) => (
              <div
                key={type}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => drop(type)}
                className="min-h-[104px] space-y-1.5 rounded-lg border border-dashed border-border p-1.5"
              >
                <p className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
                  {type}
                </p>
                {placed
                  .filter((s) => s.type === type)
                  .map((s) => (
                    <div
                      key={s.id}
                      draggable
                      onDragStart={() => setDragging(s.id)}
                      onDragEnd={() => setDragging(null)}
                      className={`${cardClass} cursor-grab active:cursor-grabbing`}
                    >
                      {s.id}
                    </div>
                  ))}
              </div>
            ))}
          </div>
          <p className="mt-3 text-[13px] text-muted-foreground">
            Drag an SOR between columns.
          </p>
        </Chrome>
      }
    />
  )
}

/* ── 3. Stage Fields (#203) ─────────────────────────────────────────────── */

const AVAILABLE_FIELDS = [
  "Purchase Order No.",
  "Delivery Date",
  "Technical Sign-off",
]

export function StageFieldsDemo() {
  const [fields, setFields] = useState(["ITB Number"])
  const [picking, setPicking] = useState(false)

  return (
    <BeforeAfter
      liveHref="/super-admin/flow-canvas"
      note="What a Stage asks is recorded against the Stage Visit, so the answers belong to that pass through the Stage rather than to the SOR as a whole."
      before={
        <Chrome title="Stage · Bidding">
          <Row muted>
            <span>ITB Number</span>
            <span className="text-[12px] font-semibold uppercase">Required</span>
          </Row>
          <p className="pt-3 text-[13px] text-muted-foreground">
            Written in code. Adding a field is a development request.
          </p>
        </Chrome>
      }
      after={
        <Chrome title="Stage · Bidding — Stage Fields">
          {fields.map((f) => (
            <Row key={f}>
              <span>{f}</span>
              <span className="text-[12px] font-semibold uppercase text-muted-foreground">
                Required
              </span>
            </Row>
          ))}
          <div className="pt-3">
            {picking ? (
              <div className="flex flex-wrap gap-1.5">
                {AVAILABLE_FIELDS.filter((f) => !fields.includes(f)).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => {
                      setFields((prev) => [...prev, f])
                      setPicking(false)
                    }}
                    className="rounded-lg border border-border px-2.5 py-1.5 text-[13px] font-semibold hover:bg-muted"
                  >
                    {f}
                  </button>
                ))}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setPicking(true)}
                className="rounded-lg border border-border bg-muted px-3 py-1.5 text-[13px] font-semibold"
              >
                + Add a field
              </button>
            )}
          </div>
        </Chrome>
      }
    />
  )
}

/* ── 4. A blocked move says so first (#203, #199) ───────────────────────── */

export function BlockedMoveDemo() {
  const [toast, setToast] = useState(false)

  return (
    <BeforeAfter
      liveHref="/crm"
      note="The same information, moved to before the click instead of after it."
      before={
        <Chrome title="SOR S07971">
          <button
            type="button"
            onClick={() => setToast(true)}
            className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-[14px] font-semibold"
          >
            Move to Bidding
          </button>
          {toast && (
            <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-[13px] font-semibold text-red-700 dark:text-red-300">
              Cannot move: ITB Number is required.
            </p>
          )}
          <p className="pt-3 text-[13px] text-muted-foreground">
            You find out after you click.
          </p>
        </Chrome>
      }
      after={
        <Chrome title="SOR S07971">
          <button
            type="button"
            disabled
            className="w-full cursor-not-allowed rounded-lg border border-border bg-muted px-3 py-2 text-[14px] font-semibold opacity-60"
          >
            Move to Bidding
          </button>
          <p className="mt-2 text-[13px] font-semibold text-amber-800 dark:text-amber-200">
            Needs ITB Number — asked on this Stage.
          </p>
          <div className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-[13px] font-semibold text-emerald-800 dark:text-emerald-200">
            Checklist 4 / 4 complete
          </div>
        </Chrome>
      }
    />
  )
}

/* ── 5. Odoo free stock on the line (#202) ──────────────────────────────── */

const LINES = [
  { name: "Stretcher, hydraulic", qty: 12, free: 18 },
  { name: "Mattress, foam 4in", qty: 12, free: 4 },
  { name: "IV pole, 4-hook", qty: 24, free: 0 },
]

function stockTone(free, qty) {
  if (free === 0) return "bg-red-500/10 text-red-700 dark:text-red-300"
  if (free < qty) return "bg-amber-500/10 text-amber-800 dark:text-amber-200"
  return "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200"
}

export function StockBadgesDemo() {
  return (
    <BeforeAfter
      liveHref="/crm"
      note="The figure is stamped when it is pulled, so what you are reading has a known age rather than being assumed current."
      before={
        <Chrome title="SOR S07971 · Product List">
          {LINES.map((l) => (
            <Row key={l.name}>
              <span>{l.name}</span>
              <span className="text-muted-foreground">×{l.qty}</span>
            </Row>
          ))}
          <p className="pt-3 text-[13px] text-muted-foreground">
            Open Odoo in another tab to check stock.
          </p>
        </Chrome>
      }
      after={
        <Chrome title="SOR S07971 · Product List">
          {LINES.map((l) => (
            <Row key={l.name}>
              <span className="min-w-0 truncate">{l.name}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-muted-foreground">×{l.qty}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[12px] font-bold ${stockTone(l.free, l.qty)}`}
                >
                  {l.free} free
                </span>
              </span>
            </Row>
          ))}
        </Chrome>
      }
    />
  )
}

/* ── 6. A second way in (#162–#165) ─────────────────────────────────────── */

export function LoginDemo() {
  const [sent, setSent] = useState(false)

  return (
    <BeforeAfter
      liveHref="/login"
      note="The magic link still works. It is no longer the only way in, and a reset link is no longer spent before the person clicks it."
      before={
        <Chrome title="Sign in">
          <input
            readOnly
            value="sean@t3ckgroup.com"
            className="mb-2 w-full rounded-lg border border-border bg-card px-3 py-2 text-[14px]"
          />
          <button
            type="button"
            onClick={() => setSent(true)}
            className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-[14px] font-semibold"
          >
            Send magic link
          </button>
          <p className="pt-3 text-[13px] text-muted-foreground">
            {sent
              ? "Sent. If the email is slow or missing, nobody works."
              : "The only way in."}
          </p>
        </Chrome>
      }
      after={
        <Chrome title="Sign in">
          <input
            readOnly
            value="sean@t3ckgroup.com"
            className="mb-2 w-full rounded-lg border border-border bg-card px-3 py-2 text-[14px]"
          />
          <input
            readOnly
            type="password"
            value="password"
            className="mb-2 w-full rounded-lg border border-border bg-card px-3 py-2 text-[14px]"
          />
          <button
            type="button"
            className="w-full rounded-lg border-2 border-emerald-500/30 bg-muted px-3 py-2 text-[14px] font-bold"
          >
            Sign in
          </button>
          <p className="pt-3 text-[13px] text-muted-foreground">
            Or email me a link instead.
          </p>
        </Chrome>
      }
    />
  )
}

