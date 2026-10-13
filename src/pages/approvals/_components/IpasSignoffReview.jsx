import { Link } from "react-router";
import { Button, buttonVariants } from "@/components/ui/button";
import { ApprovalChain, DetailRow, DetailSection, PersonChip } from "@/components/ui/DetailParts";
import { SlideOverBody, SlideOverFooter } from "@/components/ui/SlideOver";
import { IPAS_PRIORITY_LABELS, IPAS_PURPOSE_LABELS, IPAS_SECTION_NAMES } from "../../../constants/ipas";
import { formatAmount } from "../../../utils/ipas";
import { relativeAge } from "../../../utils/approvalItems.js";
import { APPROVE_CLASS, whyYouSeeThis } from "./approvalUi";

/**
 * Reviewing one IPAS section as its approver (#247, sections 1 and 3). The
 * summary is only enough to recognise it; the full IPAS (lines, payments,
 * documents, bank details) is one click away, and the approver is expected to
 * read it there. `onApprove(item)` signs it; `onSendBack(item)` opens the reason
 * dialog the page owns.
 */
export function IpasSignoffReview({ item, onApprove, onSendBack, isSubmitting }) {
  const pending = item.source;

  return (
    <>
      <SlideOverBody>
        <PersonChip person={item.person} size="lg" detail="Prepared it" />

        <DetailSection title="IPAS">
          <dl className="divide-y divide-border/70">
            <DetailRow label="Number">{pending.number}</DetailRow>
            <DetailRow label="Odoo PO">{pending.poNumber}</DetailRow>
            <DetailRow label="Supplier">{pending.supplier}</DetailRow>
            <DetailRow label="Purpose">{IPAS_PURPOSE_LABELS[pending.purpose] ?? pending.purpose}</DetailRow>
            <DetailRow label="Priority">{IPAS_PRIORITY_LABELS[pending.priority] ?? pending.priority}</DetailRow>
            <DetailRow label="PO total">{formatAmount(pending.total, pending.currency)}</DetailRow>
            <DetailRow label="Section">
              {pending.section} · {IPAS_SECTION_NAMES[pending.section]}
            </DetailRow>
            <DetailRow label="Waiting">
              <span className={item.isStale ? "font-semibold text-amber-11" : ""}>{relativeAge(item.clockAt).replace(" ago", "")}</span>
            </DetailRow>
          </dl>
          <Link to={`/purchasing/ipas/${pending.ipasId}`} className={buttonVariants({ variant: "outline", size: "sm", className: "mt-3" })}>
            Open the IPAS
          </Link>
        </DetailSection>

        <DetailSection title="Sign-off chain">
          <ApprovalChain chain={item.chain} />
        </DetailSection>

        <p className="rounded-xl bg-muted/60 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">Why you’re seeing this. </span>
          {whyYouSeeThis(item)}
        </p>
      </SlideOverBody>

      <SlideOverFooter>
        <div className="flex gap-2">
          <Button variant="outline" className="flex-1" disabled={isSubmitting} onClick={() => onSendBack(item)}>
            Send back
          </Button>
          <Button className={`flex-1 ${APPROVE_CLASS}`} disabled={isSubmitting} onClick={() => onApprove(item)}>
            Approve
          </Button>
        </div>
      </SlideOverFooter>
    </>
  );
}
