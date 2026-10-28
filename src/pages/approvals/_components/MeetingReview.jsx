import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ApprovalChain, DetailRow, DetailSection, NotePresets, PersonChip } from "@/components/ui/DetailParts";
import { SlideOverBody, SlideOverFooter } from "@/components/ui/SlideOver";
import { APPROVE_CLASS } from "@/components/ui/approveClass";
import { formatManilaDateTime, manilaTime } from "../../../lib/manilaDate.js";
import { NOTE_PRESETS, whyYouSeeThis } from "./approvalUi";

const EVENT_LABEL = {
  FILED: "Filed",
  HEAD_APPROVED: "Head approved",
  HEAD_DECLINED: "Head declined",
  HEAD_RETURNED: "Head returned",
  HR_APPROVED: "HR approved",
  HR_DECLINED: "HR declined",
  HR_RETURNED: "HR returned",
  HR_OVERRIDE: "HR skipped the head step",
};

/**
 * Reviewing one Meeting Request (#624). `onDecide(item, decision, note)` with decision
 * APPROVE | DECLINE | RETURN (a note is required for the last two). HR is the only approver (#748).
 */
export function MeetingReview({ item, onDecide, isSubmitting }) {
  const req = item.source;
  const [note, setNote] = useState("");
  const needsNote = note.trim() === "";
  const people = (req.participants ?? []).map((p) => p.employee?.name).filter(Boolean);
  const guests = req.guests ?? [];

  return (
    <>
      <SlideOverBody>
        <PersonChip person={item.person} size="lg" />

        <DetailSection title="Meeting">
          <dl className="divide-y divide-border/70">
            <DetailRow label="Venue">{req.venue?.name}</DetailRow>
            <DetailRow label="When">{`${formatManilaDateTime(req.starts_at)} to ${manilaTime(req.ends_at)}`}</DetailRow>
            <DetailRow label="Facilitator">{req.facilitator?.name}</DetailRow>
            <DetailRow label="Participants">{people.length ? people.join(", ") : "None"}</DetailRow>
            <DetailRow label="Guests">{guests.length ? guests.join(", ") : "None"}</DetailRow>
            <DetailRow label="Purpose">{req.purpose}</DetailRow>
          </dl>
        </DetailSection>

        <DetailSection title="Approval chain">
          <ApprovalChain chain={item.chain} />
        </DetailSection>

        <DetailSection title="History">
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            {(req.events ?? []).map((e) => (
              <li key={e.id}>
                <span className="font-semibold text-foreground">{EVENT_LABEL[e.action] ?? e.action}</span>
                {e.actor?.name ? ` · ${e.actor.name}` : ""} · {formatManilaDateTime(e.created_at)}
                {e.note ? ` · "${e.note}"` : ""}
              </li>
            ))}
          </ul>
        </DetailSection>

        <p className="rounded-xl bg-muted/60 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">Why you’re seeing this. </span>
          {whyYouSeeThis(item)}
        </p>
      </SlideOverBody>

      <SlideOverFooter>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          aria-label="Note to the applicant"
          placeholder="Note (required to decline or return)"
          className="min-h-0 resize-none bg-card text-[13px] md:text-[13px]"
        />
        <NotePresets presets={NOTE_PRESETS.meetings} onPick={(q) => setNote((n) => (n ? `${n} ${q}` : q))} />
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" disabled={isSubmitting || needsNote} onClick={() => onDecide(item, "RETURN", note)}>
            Return
          </Button>
          <Button variant="destructive" className="flex-1" disabled={isSubmitting || needsNote} onClick={() => onDecide(item, "DECLINE", note)}>
            Decline
          </Button>
          <Button className={`flex-1 ${APPROVE_CLASS}`} disabled={isSubmitting} onClick={() => onDecide(item, "APPROVE", note)}>
            Approve
          </Button>
        </div>
      </SlideOverFooter>
    </>
  );
}
