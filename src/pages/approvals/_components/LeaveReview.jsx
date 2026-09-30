import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { leaveWhen, relativeAge } from "../../../utils/approvalItems.js";
import { ApprovalChain, DetailRow, NotePresets, Person, SheetSection } from "./ApprovalParts";
import { SheetBody, SheetFooter } from "./ApprovalSheet";
import { APPROVE_CLASS, NOTE_PRESETS, whyYouSeeThis } from "./approvalUi";

/**
 * Reviewing one leave, Offset, overtime or undertime request as its department
 * head. The note is optional either way; `onDecide(item, status, note)` records
 * the head's decision (APPROVED / REJECTED) before HR can act on it.
 */
export function LeaveReview({ item, onDecide, isSubmitting }) {
  const req = item.source;
  const [note, setNote] = useState("");

  return (
    <>
      <SheetBody>
        <Person person={item.person} size="lg" />

        <SheetSection title="Details">
          <dl className="divide-y divide-border/70">
            <DetailRow label="Type">{item.typeLabel}</DetailRow>
            <DetailRow label="When">{leaveWhen(req)}</DetailRow>
            <DetailRow label="Reason">{req.reason}</DetailRow>
            <DetailRow label="Waiting">
              <span className={item.isStale ? "font-semibold text-amber-11" : ""}>{relativeAge(item.clockAt).replace(" ago", "")}</span>
            </DetailRow>
          </dl>
        </SheetSection>

        <SheetSection title="Approval chain">
          <ApprovalChain chain={item.chain} />
        </SheetSection>

        <p className="rounded-xl bg-muted/60 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">Why you’re seeing this. </span>
          {whyYouSeeThis(item)}
        </p>
      </SheetBody>

      <SheetFooter>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Note to employee (optional)" className="min-h-0 resize-none bg-card text-[13px] md:text-[13px]" />
        <NotePresets presets={NOTE_PRESETS.leaves} onPick={(q) => setNote((n) => (n ? `${n} ${q}` : q))} />
        <div className="flex gap-2">
          <Button variant="destructive" className="flex-1" disabled={isSubmitting} onClick={() => onDecide(item, "REJECTED", note)}>
            Decline
          </Button>
          <Button className={`flex-1 ${APPROVE_CLASS}`} disabled={isSubmitting} onClick={() => onDecide(item, "APPROVED", note)}>
            Approve
          </Button>
        </div>
      </SheetFooter>
    </>
  );
}
