import { useEffect, useState } from "react"
import toast from "react-hot-toast"
import { PenLine, Plus } from "lucide-react"
import { SampleAuthProvider } from "@/context/AuthContext"
import TabGroup from "@/components/ui/TabGroup"
import { Button } from "@/components/ui/button"
import ApplyLeaveModal from "../offsets/ApplyLeaveModal"
import SignatureCaptureModal from "../profile/SignatureCaptureModal"
import RequestsTable from "../../pages/offsets/_components/RequestsTable"
import { getFormType } from "../../lib/pdf/formTypeRegistry"
import { buildPrintableDocument, hydrateRecordsForPrint } from "../../lib/pdf/htmlPrinter"
import SampleProvider, { SAMPLE_SAVE_BLOCKED } from "./SampleProvider"
import { PEOPLE, daysAgo, hoursAgo, isoDate } from "./sampleData"

/**
 * Filing leave, overtime and undertime, the head-then-HR approval, and the
 * printed forms, as the app's own components fed Sample Data (ADR 0030).
 */

const noop = () => {}

// A date n days away, moved to the Monday after if it lands on a weekend:
// leave and undertime are filed for working days.
const workday = (n) => {
  const day = new Date(`${isoDate(n)}T00:00:00`).getDay()
  return isoDate(n + (day === 6 ? 2 : day === 0 ? 1 : 0))
}

// Days away of the first Monday at least n days away. Monday to Wednesday
// (+2) is a three-day leave that never spans a weekend.
const monday = (n) => {
  const day = new Date(`${isoDate(n)}T00:00:00`).getDay()
  return n + ((8 - day) % 7)
}

/* ── One form for leave, overtime and undertime ─────────────────────────── */

// Signed in as Lara for the form, so it reads her department and balances,
// never the viewer's own.
const APPLICANT = { ...PEOPLE.lara, offset_hours_balance: 12, sil_hours_balance: 40 }

const HEADS = [
  { ...PEOPLE.carlo, isHead: true },
  { ...PEOPLE.mark, isHead: true },
]

const LEAVE_CATEGORIES = [
  { id: "c-vacation", label: "Vacation Leave" },
  { id: "c-sick", label: "Sick Leave" },
  { id: "c-emergency", label: "Emergency Leave" },
]

export function LeaveFormSample() {
  const [open, setOpen] = useState(false)
  return (
    <SampleProvider
      seed={[
        [["activeLeaveCategories"], LEAVE_CATEGORIES],
        [["departmentHeads"], HEADS],
        [["pendingOffsetHours", APPLICANT.id], 4],
        [["pendingSilHours", APPLICANT.id], 0],
      ]}
    >
      <SampleAuthProvider user={APPLICANT}>
        <Button type="button" onClick={() => setOpen(true)}>
          <Plus size={16} />
          Apply Leave / OT
        </Button>
        <ApplyLeaveModal isOpen={open} onClose={() => setOpen(false)} onSuccess={noop} />
      </SampleAuthProvider>
    </SampleProvider>
  )
}

/* ── Head first, then HR: My Requests shows where each one is ───────────── */

const byMark = { head_id: PEOPLE.mark.id, head: { name: PEOPLE.mark.name } }

const MY_REQUESTS = [
  {
    id: "rq-1",
    type: "SIL",
    created_at: hoursAgo(2),
    date: isoDate(monday(10)),
    startDate: isoDate(monday(10)),
    endDate: isoDate(monday(10) + 2),
    dayCount: 3,
    hours: 24,
    status: "PENDING",
    head_status: "PENDING",
    ...byMark,
  },
  {
    id: "rq-2",
    type: "OFFSET",
    created_at: daysAgo(1),
    date: workday(3),
    hours: 4,
    start_time: "13:00:00",
    end_time: "17:00:00",
    status: "PENDING",
    head_status: "APPROVED",
    ...byMark,
  },
  {
    id: "rq-3",
    type: "SIL",
    created_at: daysAgo(3),
    date: workday(8),
    hours: 8,
    status: "PENDING",
    head_status: "REJECTED",
    head_note: "Two of the team are already out that day. Could you move it?",
    ...byMark,
  },
  {
    id: "rq-4",
    type: "OVERTIME",
    created_at: daysAgo(6),
    date: workday(-7),
    hours: 3,
    approved_hours: 2,
    start_time: "17:00:00",
    end_time: "20:00:00",
    status: "APPROVED_OFFSET",
    head_status: "APPROVED",
    ...byMark,
  },
  {
    id: "rq-5",
    type: "UNDERTIME",
    created_at: daysAgo(9),
    date: workday(-9),
    hours: 1.5,
    status: "APPROVED",
    head_status: "APPROVED",
    printed_at: daysAgo(7),
    ...byMark,
  },
]

export function RequestStagesSample() {
  return (
    <SampleProvider>
      <RequestsTable rows={MY_REQUESTS} onWithdraw={() => toast(SAMPLE_SAVE_BLOCKED, { id: "sample-save-blocked" })} />
    </SampleProvider>
  )
}

/* ── Printed forms: TG-11, TG-12 and TG-13 ──────────────────────────────── */

const onForm = (person, role) => ({ ...person, role, employment_status: "Regular" })

// Every plate signed, so the band shows all three: applicant, head, HR. The
// verification token is made up, so the QR code leads to no record.
const SIGNED = {
  company: { name: "Demo Trading Co." },
  head: { name: PEOPLE.mark.name },
  head_id: PEOPLE.mark.id,
  head_status: "APPROVED",
  hr: { name: PEOPLE.nina.name },
}

const PRINTED_FORMS = [
  {
    value: "leave",
    label: "Leave · TG-11",
    record: {
      ...SIGNED,
      id: "sample-lv-0001",
      type: "SIL",
      status: "APPROVED",
      created_at: daysAgo(14),
      date: isoDate(monday(-14)),
      startDate: isoDate(monday(-14)),
      endDate: isoDate(monday(-14) + 2),
      dayCount: 3,
      hours: 24,
      category: { label: "Vacation Leave" },
      reason: "Family event in the province.",
      employee: onForm(PEOPLE.lara, "Account Manager"),
      employee_signature_timestamp: daysAgo(14),
      head_decided_at: daysAgo(13),
      hr_signature_timestamp: daysAgo(12),
      hr_processed_at: daysAgo(12),
      approval_credits_snapshot: 16,
      verification_token: "sample-leave",
    },
  },
  {
    value: "overtime",
    label: "Overtime · TG-12",
    record: {
      ...SIGNED,
      id: "sample-ot-0002",
      type: "OVERTIME",
      status: "APPROVED_OFFSET",
      created_at: daysAgo(7),
      date: workday(-7),
      hours: 3,
      requested_hours: 3,
      approved_hours: 2,
      start_time: "17:00",
      end_time: "20:00",
      reason: "Finished the bid documents for Demo Province.",
      employee: onForm(PEOPLE.paolo, "Account Manager"),
      employee_signature_timestamp: daysAgo(7),
      head_decided_at: daysAgo(6),
      hr_signature_timestamp: daysAgo(5),
      hr_processed_at: daysAgo(5),
      approval_credits_snapshot: 10,
      verification_token: "sample-overtime",
    },
  },
  {
    value: "undertime",
    label: "Undertime · TG-13",
    record: {
      ...SIGNED,
      head: { name: PEOPLE.carlo.name },
      head_id: PEOPLE.carlo.id,
      id: "sample-ut-0003",
      type: "UNDERTIME",
      status: "APPROVED",
      created_at: daysAgo(4),
      date: workday(-4),
      hours: 1.5,
      approved_hours: 1.5,
      original_start_time: "08:00",
      original_end_time: "17:00",
      actual_start_time: "08:00",
      actual_end_time: "15:30",
      reason: "Clinic appointment in the afternoon.",
      employee: onForm(PEOPLE.joy, "Purchasing Officer"),
      employee_signature_timestamp: daysAgo(4),
      head_decided_at: daysAgo(4),
      hr_signature_timestamp: daysAgo(3),
      hr_processed_at: daysAgo(3),
      verification_token: "sample-undertime",
    },
  },
]

// The Document Center's own pipeline: view model, QR code, printable page.
// Nothing here is marked printed; that happens only when HR prints. A
// signature drawn in the sample goes on the applicant's plate.
function usePrintedPage(record, applicantSignature = null) {
  const [html, setHtml] = useState("")
  useEffect(() => {
    let cancelled = false
    hydrateRecordsForPrint([record])
      .catch(() => [{ ...getFormType(record.type).buildViewModel(record), qrDataUrl: "", qrText: "" }])
      .then(([page]) => {
        if (applicantSignature) page.sigs[0].signatureBase64 = applicantSignature
        if (!cancelled) setHtml(buildPrintableDocument([page]))
      })
    return () => {
      cancelled = true
    }
  }, [record, applicantSignature])
  return html
}

export function PrintedFormsSample() {
  const [form, setForm] = useState(PRINTED_FORMS[0].value)
  const html = usePrintedPage(PRINTED_FORMS.find((f) => f.value === form).record)

  return (
    <div className="space-y-4">
      <TabGroup variant="pill" size="sm" tabs={PRINTED_FORMS.map(({ value, label }) => ({ value, label }))} activeTab={form} onChange={setForm} />
      {/* One half-sheet: the top slip of the Letter page the form prints on. */}
      <iframe
        title="Printed form, sample"
        srcDoc={html}
        scrolling="no"
        className="block h-[528px] w-[816px] max-w-none rounded-sm border-0 bg-white shadow-[0_8px_24px_-8px_rgba(0,0,0,0.25)]"
      />
    </div>
  )
}

/* ── Your signature, drawn once in Profile ──────────────────────────────── */

const readAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })

export function SignatureSample() {
  const [open, setOpen] = useState(false)
  const [signature, setSignature] = useState(null)
  const html = usePrintedPage(PRINTED_FORMS[0].record, signature)

  // Puts the drawing on the form instead of storing it, and says so: a
  // "Signature saved." here would leave someone thinking Profile has theirs.
  const save = async (_employeeId, file) => {
    setSignature(await readAsDataUrl(file))
    setOpen(false)
    throw new Error(`${SAMPLE_SAVE_BLOCKED} Add yours in Profile.`)
  }

  return (
    <SampleProvider>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => setOpen(true)}
            className="h-auto gap-1.5 rounded-full bg-muted/50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest hover:bg-muted"
          >
            <PenLine size={14} /> Add Signature
          </Button>
          <p className="text-xs text-muted-foreground">Draw one and press Save: it goes on the Requested by line below.</p>
        </div>
        {/* The signature band of a leave form, cropped from the printed page. */}
        <div className="h-[150px] w-[816px] overflow-hidden rounded-sm bg-white shadow-[0_8px_24px_-8px_rgba(0,0,0,0.25)]">
          <iframe title="Signatures on a printed form, sample" srcDoc={html} scrolling="no" className="-mt-[362px] block h-[528px] w-[816px] max-w-none border-0" />
        </div>
      </div>
      <SignatureCaptureModal isOpen={open} onClose={() => setOpen(false)} employeeId={APPLICANT.id} save={save} />
    </SampleProvider>
  )
}
