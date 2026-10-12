import { useRef } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import ItemsTab from "../sor/modal/ItemsTab"
import SorChatColumn from "../sor/modal/SorChatColumn"
import { formatPHP } from "../../constants/sor"
import SampleProvider from "./SampleProvider"
import BeforeAfter, { ScreenshotPair } from "./BeforeAfter"
import { PEOPLE, SAMPLE_ACTOR, SAMPLE_LINES, hoursAgo } from "./sampleData"

/**
 * Fixes shown as the same screen before and after (ADR 0030). Where the bug
 * was in the data, the app's own component is fed the data the bug produced
 * and the data it produces now. Where the old screen is gone from the code,
 * it is a pair of screenshots (see ScreenshotPair).
 */

const noop = () => {}

/* ── Product List could double ──────────────────────────────────────────── */

const withIds = (lines, prefix) => lines.map((line, i) => ({ ...line, id: `${prefix}-${i}`, sort_order: i }))

function ProductList({ id, items }) {
  const opportunity = { id, sales_reference: "S00002", client_name: "Demo City Hospital" }
  const ctx = {
    opportunity,
    id,
    items,
    itemsLoading: false,
    isEditing: false,
    editForm: {},
    setEditForm: noop,
    user: { id: SAMPLE_ACTOR },
    invalidate: noop,
    autoSyncingOdoo: false,
    handleRefreshStock: noop,
    refreshingStock: false,
    accessLevel: "full",
  }
  return (
    <SampleProvider seed={[[["sorModalTab", "items", id], null]]}>
      <div className="h-[420px]">
        <ItemsTab ctx={ctx} hasOpened={() => true} />
      </div>
    </SampleProvider>
  )
}

export function ProductListDoublingSample() {
  return (
    <BeforeAfter
      beforeNote="Open in two places at once: every line twice, the Estimated Value doubled."
      afterNote="Saving replaces the list in one step, so it cannot stack."
      before={<ProductList id="doubled" items={withIds([...SAMPLE_LINES, ...SAMPLE_LINES], "d")} />}
      after={<ProductList id="fixed" items={withIds(SAMPLE_LINES, "f")} />}
    />
  )
}

/* ── A false "Added product(s)" on every open ───────────────────────────── */

const ADDED = {
  type: "SYSTEM",
  content: "Details updated",
  metadata: {
    changes: ["Added product(s): Demo hospital bed, manual ×10, Demo mattress, foam ×10, Demo IV pole ×20"],
  },
}
const REAL_NOTES = [
  { id: "n1", type: "COMMENT", author: PEOPLE.lara, content: "Pre-bid conference is on Friday. I'll attend for the team.", created_at: hoursAgo(30) },
  { id: "n2", type: "SYSTEM", content: "Stage moved: Technical Review → Bid Submitted", created_at: hoursAgo(26) },
]
const SPURIOUS = [
  { id: "s1", ...ADDED, created_at: hoursAgo(20) },
  { id: "s2", ...ADDED, created_at: hoursAgo(9) },
  { id: "s3", ...ADDED, created_at: hoursAgo(2) },
]

const oldestFirst = (notes) => [...notes].sort((a, b) => a.created_at.localeCompare(b.created_at))

function Notes({ notes }) {
  const fileInputRef = useRef(null)
  return (
    <div className="h-[380px]">
      <SorChatColumn
        notes={notes}
        loadingNotes={false}
        handleMentionClick={noop}
        note=""
        setNote={noop}
        noteMentions={[]}
        setNoteMentions={noop}
        employees={[]}
        attachments={{ files: [], isUploading: false, max: 5, addFiles: noop, removeFile: noop, addFromPaste: noop }}
        fileInputRef={fileInputRef}
        isPosting={false}
        handlePostNote={noop}
      />
    </div>
  )
}

export function SpuriousAddedProductsSample() {
  return (
    <SampleProvider>
      <BeforeAfter
        beforeNote="Opening the SOR logged the whole Product List as newly added. Every time."
        afterNote="Opening an SOR writes nothing to its Chat."
        before={<Notes notes={oldestFirst([...REAL_NOTES, ...SPURIOUS])} />}
        after={<Notes notes={oldestFirst(REAL_NOTES)} />}
      />
    </SampleProvider>
  )
}

/* ── Lost SORs left the commission pool ─────────────────────────────────── */

const POOL = [
  { ref: "S00005", client: "Demo Town Hall", stage: "Awarded", value: 2000000 },
  { ref: "S00006", client: "Demo Health Office", stage: "Awarded", value: 1000000 },
  { ref: "S00007", client: "Demo Rescue Unit", stage: "Closed Lost", value: 4000000, lost: true },
]

function Pool({ rows }) {
  const total = rows.reduce((sum, r) => sum + r.value, 0)
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Sales Ref.</TableHead>
          <TableHead>Company</TableHead>
          <TableHead>Stage</TableHead>
          <TableHead className="text-right">Won</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.ref}>
            <TableCell className="font-mono text-xs font-bold">{r.ref}</TableCell>
            <TableCell>{r.client}</TableCell>
            <TableCell className={r.lost ? "font-semibold text-red-11" : "text-muted-foreground"}>{r.stage}</TableCell>
            <TableCell className="text-right tabular-nums">{formatPHP(r.value)}</TableCell>
          </TableRow>
        ))}
        <TableRow>
          <TableCell colSpan={3} className="font-bold">
            Commission Pool is drawn from
          </TableCell>
          <TableCell className="text-right font-bold tabular-nums">{formatPHP(total)}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
}

export function LostCommissionPoolSample() {
  return (
    <BeforeAfter
      beforeNote="An SOR moved to Closed Lost on a Sales Flow still counted as won."
      afterNote="Closed Lost on any Sales Flow leaves the pool."
      before={<Pool rows={POOL} />}
      after={<Pool rows={POOL.filter((r) => !r.lost)} />}
    />
  )
}

/* ── Screens that changed shape ─────────────────────────────────────────── */

export function RegistrationPickersSample() {
  return (
    <ScreenshotPair
      name="registration-pickers"
      before="Registering asked you to assign people for the first Stage."
      after="Registering only registers. Each Stage asks for its own people when the SOR reaches it."
    />
  )
}

export function BoardEmptyStateSample() {
  return (
    <ScreenshotPair
      name="board-empty"
      before="An empty register on the Board: a column per Stage, each one empty."
      after="One clear message, the same as the list shows."
    />
  )
}

export function ConsistentLookSample() {
  return (
    <ScreenshotPair
      name="consistent-look"
      before="Each screen drew its own: the browser's plain dropdowns, hand-made tables and pop-ups."
      after="The same pick-lists, tables and pop-ups on every screen, keyboard included."
    />
  )
}
