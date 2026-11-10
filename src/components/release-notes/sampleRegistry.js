import { CalendarSample, LeaveRangeSample, MeetingRequestSample } from "./timeOffSamples"
import { GroupTaskDatesSample, GroupTaskEvaluationSample, TaskApprovalsSample } from "./taskSamples"
import { ChangeNotesSample, MarkLostSample, MyWorkSample, NeedsAttentionSample, S0CardSample } from "./sorSamples"

/**
 * Maps an item's `sample` key in content.js to the component that renders it.
 * The release-notes test fails if an item names a key missing here, if a key
 * here is unused, or if any sample reaches the network.
 *
 * Throwaway (ADR 0030, 2026-11 amendment): a sample renders a real component,
 * but a real component never changes to keep a sample working. If a sample
 * breaks, delete it here and in its file; its item shows as text only.
 */
export const SAMPLES = {
  // SORs
  "my-work": MyWorkSample,
  "mark-lost": MarkLostSample,
  "s0-card": S0CardSample,
  "needs-attention": NeedsAttentionSample,
  "change-notes": ChangeNotesSample,
  // Tasks
  "group-task-evaluation": GroupTaskEvaluationSample,
  "group-task-dates": GroupTaskDatesSample,
  "task-approvals": TaskApprovalsSample,
  // Time Off & Calendar
  calendar: CalendarSample,
  "meeting-requests": MeetingRequestSample,
  "leave-range": LeaveRangeSample,
}

/**
 * How far a reader can play with a sample. Most are live — the real
 * component, so clicks, typing and drags all work and nothing saves — and the
 * page invites the reader to try them. These are not, and must not say so:
 * "look" is locked with ReadOnly, "pictures" are screenshots.
 */
export const SAMPLE_MODE = {}
