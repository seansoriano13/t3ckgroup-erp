import { useRef } from "react"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import ItemsTab from "../sor/modal/ItemsTab"
import SorChatColumn from "../sor/modal/SorChatColumn"
import { formatPHP } from "../../constants/sor"
import SampleProvider from "./SampleProvider"
import BeforeAfter, { ScreenshotPair } from "./BeforeAfter"

/**
 * Under the hood: one slide per fix, each the same screen before and after.
 * Where the bug was in the data, the app's own component is fed the data the
 * bug produced and the data it produces now. Where the old screen is gone
 * from the code, it is a screenshot pair (see ScreenshotPair).
 */

const noop = () => {}
const hoursAgo = (n) => new Date(Date.now() - n * 3600000).toISOString()

/* ── Product List could double ──────────────────────────────────────────── */

const LINES = [
  { product_name: "[M8101HV] Meret Omni Pro X (High Viz)", unit: "Set", quantity: 65, unit_price: 58424, odoo_product_id: 11258 },
  { product_name: "[M8120-TB] Meret Efak Pro X (black)", unit: "pc", quantity: 140, unit_price: 4946, odoo_product_id: 11266 },
  { product_name: "[SC357E2] Dinglee eDraulic Combi Tool", unit: "Unit", quantity: 1, unit_price: 523800, odoo_product_id: 9120 },
]
const withIds = (lines, prefix) => lines.map((line, i) => ({ ...line, id: `${prefix}-${i}`, sort_order: i }))

function ProductList({ id, items }) {
  const opportunity = { id, sales_reference: "S98001", client_name: "Province of Sierra Alta — PDRRMO" }
  const ctx = {
    opportunity,
    id,
    items,
    itemsLoading: false,
    isEditing: false,
    editForm: {},
    setEditForm: noop,
    user: { id: "sample-actor" },
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
      afterNote="Saving replaces the list in one step. It cannot stack."
      before={<ProductList id="doubled" items={withIds([...LINES, ...LINES], "d")} />}
      after={<ProductList id="fixed" items={withIds(LINES, "f")} />}
    />
  )
}

/* ── A false "Added product(s)" on every open ───────────────────────────── */

const AUTHOR = { id: "a1", name: "Maria Duran" }
const ADDED = {
  type: "SYSTEM",
  content: "Details updated",
  metadata: {
    changes: [
      "Added product(s): [M8101HV] Meret Omni Pro X (High Viz) ×65, [M8120-TB] Meret Efak Pro X (black) ×140, [SC357E2] Dinglee eDraulic Combi Tool ×1",
    ],
  },
}
const REAL_NOTES = [
  { id: "n1", type: "COMMENT", author: AUTHOR, content: "Pre-bid is online on the 18th. I'll join for the bid team.", created_at: hoursAgo(30) },
  { id: "n2", type: "SYSTEM", content: "Stage moved: Qualified → For Bidding", created_at: hoursAgo(26) },
]
const SPURIOUS = [
  { id: "s1", ...ADDED, created_at: hoursAgo(20) },
  { id: "s2", ...ADDED, created_at: hoursAgo(9) },
  { id: "s3", ...ADDED, created_at: hoursAgo(2) },
]

const oldestFirst = (notes) => [...notes].sort((a, b) => a.created_at.localeCompare(b.created_at))

function Notes({ notes }) {
  const containerRef = useRef(null)
  const fileInputRef = useRef(null)
  return (
    <div className="h-[380px]">
      <SorChatColumn
        notes={notes}
        loadingNotes={false}
        notesContainerRef={containerRef}
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
    <BeforeAfter
      beforeNote="A department head opening the SOR logged the whole list as newly added. Every time."
      afterNote="Opening an SOR writes nothing to its timeline."
      before={<Notes notes={oldestFirst([...REAL_NOTES, ...SPURIOUS])} />}
      after={<Notes notes={oldestFirst(REAL_NOTES)} />}
    />
  )
}

/* ── Lost SORs left the commission pool ─────────────────────────────────── */

const POOL = [
  { ref: "S07213", client: "Municipality of San Andres", stage: "Collection", value: 2840000 },
  { ref: "S07488", client: "Provincial Health Office", stage: "Closed Won", value: 1965000 },
  { ref: "S07702", client: "City DRRMO, Sta. Lucia", stage: "Closed Lost", value: 4120000, lost: true },
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
            <TableCell className={r.lost ? "font-semibold text-red-700 dark:text-red-300" : "text-muted-foreground"}>{r.stage}</TableCell>
            <TableCell className="text-right tabular-nums">{formatPHP(r.value)}</TableCell>
          </TableRow>
        ))}
        <TableRow>
          <TableCell colSpan={3} className="font-bold">Commission pool is drawn from</TableCell>
          <TableCell className="text-right font-bold tabular-nums">{formatPHP(total)}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  )
}

export function LostCommissionPoolSample() {
  return (
    <BeforeAfter
      beforeNote="An SOR moved to a Sales Flow's Closed Lost still counted as Won."
      afterNote="Closed Lost on any flow leaves the pool."
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
      after="Registering only registers. The Stage asks on the SOR's Now tab; the form says which Sale Type's fields it shows."
    />
  )
}

export function BoardEmptyStateSample() {
  return (
    <ScreenshotPair
      name="board-empty"
      before="An empty register on the Board: a column per Stage, each saying nothing is there."
      after="The register's own empty state, on the Board as on the List."
    />
  )
}
