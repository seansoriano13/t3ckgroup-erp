import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Pencil } from "lucide-react";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/Tooltip";
import StatusBadge from "@/components/StatusBadge";
import { SALES_REFERENCE_HINT, isValidSalesReference, normalizeSalesReference } from "@/constants/sor";
import { opportunityService } from "@/services/opportunityService";

// Reasons live in hover text only (CONTEXT.md, "Hover detail"); the card shows icons and badges.
const ODOO_BADGES = {
  found: { label: "In Odoo", theme: "green", hover: "Odoo has this S0." },
  not_checked: {
    label: "Not checked",
    theme: "amber",
    hover: "Odoo did not answer when this was saved. It is checked again when the SOR opens.",
  },
  gone: { label: "Gone from Odoo", theme: "red", hover: (s0) => `Odoo no longer has ${s0}.` },
};

const formatReadAt = (iso) =>
  iso ? new Date(iso).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" }) : null;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The warning shown before a change or clear that would touch products (#818). Words the three
 * counts, e.g. "12 products will be marked Removed from S0. 5 Requested Items and 3 Tender Lines
 * stay on them." Returns null when all are zero.
 */
function previewMessage(preview) {
  const removed = preview?.removed_products || 0;
  const requested = preview?.requested_items || 0;
  const tender = preview?.tender_lines || 0;
  if (removed + requested + tender === 0) return null;
  const parts = [];
  if (requested > 0) parts.push(plural(requested, "Requested Item", "Requested Items"));
  if (tender > 0) parts.push(plural(tender, "Tender Line", "Tender Lines"));
  const stay = parts.length ? ` ${parts.join(" and ")} ${requested + tender === 1 ? "stays" : "stay"} on ${removed === 1 ? "it" : "them"}.` : "";
  return `${plural(removed, "product", "products")} will be marked Removed from S0.${stay}`;
}

/**
 * The S0 input and its save (#815). Shared by the S0 card, and by the registration form (#820) and
 * the Sales Reference Stage Field (#821), so every entry point runs the same checks: it calls the one
 * save step and shows the refusal it gets back.
 *
 * `needsReason`: the S0 is locked and the caller is a Super Admin, so a reason is asked for.
 * `onSaved(result)` gets the saved S0; `onCancel` closes the editor.
 */
export function S0Input({ opportunityId, value = "", needsReason = false, onSaved, onCancel, autoFocus = true }) {
  const [draft, setDraft] = useState(value || "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState(null);
  const [checking, setChecking] = useState(false);
  const [warning, setWarning] = useState(null);

  const save = useMutation({
    mutationFn: () => opportunityService.setSalesReference(opportunityId, draft, reason),
    onSuccess: (result) => onSaved?.(result),
    onError: (err) => setError(err.message),
  });

  const typed = draft.trim();
  const formatBad = typed !== "" && !isValidSalesReference(typed);
  const unchanged = normalizeSalesReference(typed) === (value || "");
  const missingReason = needsReason && !reason.trim();

  // Before a change or clear is saved, ask what it would do to the products. Anything to warn about
  // waits for a confirm; nothing to warn about (or no answer from Odoo) saves straight away.
  const submit = async (event) => {
    event?.preventDefault();
    setError(null);
    if (formatBad) {
      setError(SALES_REFERENCE_HINT);
      return;
    }
    setChecking(true);
    let message = null;
    try {
      message = previewMessage(await opportunityService.previewSalesReferenceChange(opportunityId, draft));
    } catch {
      message = null;
    }
    setChecking(false);
    if (message) {
      setWarning(message);
      return;
    }
    save.mutate();
  };

  const busy = save.isPending || checking;

  if (warning) {
    return (
      <div role="alertdialog" aria-label="Confirm S0 change" className="flex flex-wrap items-center gap-2">
        <p className="text-[13px] font-medium text-foreground">{warning}</p>
        <Button
          type="button"
          size="sm"
          disabled={save.isPending}
          onClick={() => {
            setWarning(null);
            save.mutate();
          }}
        >
          {typed === "" ? "Confirm clear" : "Confirm change"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setWarning(null)}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-start gap-2" aria-label="Edit S0">
      <Input
        aria-label="S0"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        placeholder="S01237"
        autoFocus={autoFocus}
        autoComplete="off"
        className="font-mono"
        containerClassName="w-40"
        error={error ? true : undefined}
      />
      {needsReason && (
        <Input
          aria-label="Reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Reason for the change"
          autoComplete="off"
          containerClassName="min-w-48 flex-1"
        />
      )}
      <Button type="submit" size="sm" disabled={busy || unchanged || missingReason}>
        {busy ? "Saving…" : typed === "" ? "Clear S0" : "Save"}
      </Button>
      {onCancel && (
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      )}
      {error && (
        <p role="alert" className="basis-full text-[12px] font-medium text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

/**
 * The S0 card at the top of the SOR window (#815): the S0, whether Odoo found it, when it was last
 * read, how many products came from it, an Edit button while it can still change, and a lock icon
 * once it is locked. Reasons show on hover only.
 */
export default function S0Card({ opportunityId }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  const { data: card } = useQuery({
    queryKey: ["salesReferenceCard", opportunityId],
    queryFn: () => opportunityService.getSalesReferenceCard(opportunityId),
    enabled: Boolean(opportunityId),
  });

  if (!card) return null;

  const saved = (result) => {
    setEditing(false);
    toast.success(result?.sales_reference ? "S0 saved." : "S0 cleared.");
    queryClient.invalidateQueries({ queryKey: ["salesReferenceCard", opportunityId] });
    queryClient.invalidateQueries({ queryKey: ["globalOpportunity", opportunityId] });
    queryClient.invalidateQueries({ queryKey: ["opportunity", opportunityId] });
    queryClient.invalidateQueries({ queryKey: ["opportunities"] });
    queryClient.invalidateQueries({ queryKey: ["opportunityItems", opportunityId] });
    queryClient.invalidateQueries({ queryKey: ["opportunityNotes", opportunityId] });
  };

  const locked = card.lock === "locked";
  const badge = card.sales_reference ? ODOO_BADGES[card.odoo_state] : null;
  const readAt = formatReadAt(card.checked_at);
  const duplicates = card.sales_reference ? card.duplicates ?? [] : [];

  return (
    <div
      data-testid="s0-card"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border/60 bg-card px-3 py-2"
    >
      <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">S0</span>
      {editing ? (
        <S0Input
          opportunityId={opportunityId}
          value={card.sales_reference || ""}
          needsReason={locked}
          onSaved={saved}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          {card.sales_reference ? (
            <span className="font-mono text-sm font-bold text-foreground">{card.sales_reference}</span>
          ) : (
            <span className="text-sm font-medium text-muted-foreground">Not set</span>
          )}
          {badge && (
            <Tooltip content={typeof badge.hover === "function" ? badge.hover(card.sales_reference) : badge.hover}>
              <span>
                <StatusBadge label={badge.label} theme={badge.theme} />
              </span>
            </Tooltip>
          )}
          {duplicates.length > 0 && (
            <Tooltip
              content={duplicates.map((other) => `Also on SOR ${other.name}.`).join(" ") + " One S0 per SOR; change one."}
            >
              <span>
                <StatusBadge label="Duplicate" theme="red" />
              </span>
            </Tooltip>
          )}
          {card.sales_reference && (readAt || card.product_count > 0) && (
            <span className="text-[12px] text-muted-foreground">
              {card.product_count > 0 && `${card.product_count} ${card.product_count === 1 ? "product" : "products"}`}
              {card.product_count > 0 && readAt && " · "}
              {readAt && `Read ${readAt}`}
            </span>
          )}
          {locked && (
            <Tooltip content={`Locked after ${card.first_stage_name}`}>
              <span aria-label="Locked" role="img" className="text-muted-foreground">
                <Lock size={14} aria-hidden />
              </span>
            </Tooltip>
          )}
          {card.can_edit && (
            <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={() => setEditing(true)}>
              <Pencil data-icon="inline-start" aria-hidden />
              Edit
            </Button>
          )}
        </>
      )}
    </div>
  );
}
