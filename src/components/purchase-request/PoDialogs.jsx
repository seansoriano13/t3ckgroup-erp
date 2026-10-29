import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import toast from "react-hot-toast";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import LinerList from "@/components/record/LinerList";
import ModalShell from "@/components/ui/ModalShell";
import QueryError from "@/components/ui/QueryError";
import { FieldBox } from "@/components/ui/FieldBox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import Spinner from "@/components/ui/Spinner";
import { warningToast } from "@/components/ui/CustomToast";
import { purchaseRequestService } from "../../services/purchaseRequestService";
import { ITEM_STATUS, ITEM_STATUS_LABELS } from "../../constants/purchaseRequest";
import { p0Facts, statusFromP0 } from "../../../supabase/functions/_shared/p0Suggestions.ts";
import { p0Reference } from "../../utils/requestedItem";
import {
  PO_NUMBER_HINT,
  PO_VERIFICATION,
  PO_VERIFICATION_LABELS,
  isValidPoNumber,
  normalizePoNumber,
} from "../../constants/procurement";
import { refusal, useRefreshRequest } from "./requestHooks";
import { purchaseRequestKeys } from "./queryKeys";
import { OVER_REQUEST_MODAL } from "./stacking";

/**
 * Tells the buyer how their PO number was checked (#548): a success toast, or,
 * when Odoo didn't answer, a warning that the PO was saved without being checked.
 */
function toastPoVerdict(message, updated) {
  if (updated?.po_verification === PO_VERIFICATION.PENDING) {
    warningToast(`${message} Saved without being checked.`);
  } else toast.success(message);
}

/** What the line becomes when this P0 is attached, in the screen's words. */
function outcomeOf(p0, productId) {
  const facts = p0Facts(p0, productId);
  if (!facts) return "Cancelled in Odoo";
  const status = statusFromP0(facts);
  return status === "to_purchase" ? "RFQ: the line stays To purchase" : `The line becomes ${ITEM_STATUS_LABELS[status]}`;
}

/** One P0 from Odoo as a LinerList row; choosing it selects it, and the dialog confirms once. */
function p0Row({ p0, productId, chosen, onChoose }) {
  const bought = [...new Set(p0.lines.map((l) => l.product_name).filter(Boolean))].join(", ");
  return {
    key: p0.name,
    testId: "p0-suggestion",
    main: p0.name,
    sub: [p0.supplier, bought, outcomeOf(p0, productId)].filter(Boolean).join(" · "),
    subWrap: true,
    actions: (
      <Button
        type="button"
        size="sm"
        variant={chosen === p0.name ? "default" : "outline"}
        aria-pressed={chosen === p0.name}
        aria-label={`Choose ${p0.name}`}
        onClick={() => onChoose(p0.name)}
      >
        {chosen === p0.name ? "Chosen" : "Choose"}
      </Button>
    ),
  };
}

/**
 * Issue #684 — Attach P0 (Purchasing). Lists the P0s in Odoo whose Source Document names this
 * request's S0 (a Direct request: its PR number): those with the line's own Odoo product first,
 * then the other P0s that name it, then a field to type a number. Purchasing confirms once.
 * The server reads the P0 and sets the line from it, so the screen only names the P0.
 */
export function AttachP0Dialog({ open, onOpenChange, item, request }) {
  const requestId = request?.id;
  const refresh = useRefreshRequest(requestId);
  const [typed, setTyped] = useState("");
  const [picked, setPicked] = useState("");
  // #724: set when the server says buying has not opened for this SOR; the buyer may Order early with a reason.
  const [notOpen, setNotOpen] = useState(null);
  const [earlyReason, setEarlyReason] = useState("");
  // #788: a refusal is also written inside the dialog, where the person clicked.
  const [refused, setRefused] = useState("");
  const reference = p0Reference(request);
  const productId = item.odoo_product_id ?? null;

  const suggestions = useQuery({
    queryKey: purchaseRequestKeys.p0Suggestions(requestId, item.id),
    queryFn: () => purchaseRequestService.suggestP0s({ reference, productId }),
    enabled: open && !!reference,
    retry: false,
  });

  const typedPo = normalizePoNumber(typed);
  const typedInvalid = !!typedPo && !isValidPoNumber(typedPo);
  const chosen = typedPo && !typedInvalid ? typedPo : picked;

  const close = () => {
    setTyped("");
    setPicked("");
    setNotOpen(null);
    setEarlyReason("");
    setRefused("");
    onOpenChange(false);
  };

  const attachMutation = useMutation({
    mutationFn: () =>
      purchaseRequestService.attachP0(
        item.id,
        chosen,
        notOpen ? { orderEarly: true, orderEarlyReason: earlyReason.trim() } : undefined,
      ),
    onSuccess: (updated) => {
      toast.success(
        updated?.status === ITEM_STATUS.TO_PURCHASE
          ? `${item.name}: RFQ ${updated.po_number} attached; still To purchase.`
          : `${item.name}: ${updated?.po_number} attached; ${ITEM_STATUS_LABELS[updated?.status] || updated?.status}.`,
      );
      // #730: the IPAS follows the attach; say what happened to it (raised, SOR added, filed, or Odoo silent).
      const ipas = updated?.ipas;
      if (ipas?.message && ipas.result !== "not_project") {
        if (ipas.result === "created" || ipas.result === "sor_added" || ipas.result === "already_named") toast.success(ipas.message);
        else warningToast(ipas.message);
      }
      close();
    },
    onMutate: () => setRefused(""),
    onError: (error) => {
      if (error?.code === "buying_not_open") setNotOpen(refusal(error));
      else {
        setRefused(refusal(error));
        toast.error(refusal(error));
      }
    },
    onSettled: refresh,
  });
  const busy = attachMutation.isPending;
  const earlyMissing = !!notOpen && !earlyReason.trim();
  const rowsOf = (list) => list.map((p0) => p0Row({ p0, productId, chosen: picked, onChoose: (name) => { setTyped(""); setPicked(name); } }));

  return (
    <ModalShell
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      className={OVER_REQUEST_MODAL}
      crumbs={["Purchase Requests", "Attach P0"]}
      onSubmit={(e) => {
        e.preventDefault();
        if (chosen && !busy && !earlyMissing) attachMutation.mutate();
      }}
      actions={
        <Button size="lg" type="submit" disabled={!chosen || busy || earlyMissing}>
          {busy && <Spinner size="sm" />}
          {chosen ? `${notOpen ? "Order early and attach" : "Attach"} ${chosen}` : "Attach P0"}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        {item.name}. An RFQ keeps the line at To purchase. A confirmed P0 makes it Purchased.
      </p>
      {reference ? (
        suggestions.isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : suggestions.isError ? (
          <QueryError title={suggestions.error?.message || "Couldn't read the P0s from Odoo."} onRetry={suggestions.refetch} />
        ) : (
          <>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Suggested from Odoo</h3>
              <p className="text-xs text-muted-foreground">Their Source Document names {reference} and they list the same product.</p>
              <LinerList label="Suggested P0s" rows={rowsOf(suggestions.data.suggested)} empty="No P0 in Odoo lists this product yet." />
            </section>
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Other P0s that name {reference}</h3>
              <p className="text-xs text-muted-foreground">Different products. The line will say what was bought instead.</p>
              <LinerList label="Other P0s" rows={rowsOf(suggestions.data.others)} empty="No other P0s name it." />
            </section>
          </>
        )
      ) : (
        <p className="text-xs text-muted-foreground">This request has no S0 or PR number to search Odoo by. Type the P0 number below.</p>
      )}
      {notOpen && (
        <section className="space-y-2" data-testid="order-early">
          <p className="text-sm text-destructive">{notOpen}</p>
          <FieldBox label="Order early: why now?" bare>
            <Textarea
              value={earlyReason}
              onChange={(e) => setEarlyReason(e.target.value)}
              rows={2}
              placeholder="The Deal Owner is told this reason"
            />
          </FieldBox>
        </section>
      )}
      {refused && (
        <p className="text-sm font-semibold text-destructive" role="alert" data-testid="attach-refusal">
          {refused}
        </p>
      )}
      <div className="space-y-1.5">
        <FieldBox label="Or type a P0 number" bare>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="P01234" />
        </FieldBox>
        <p className={`pl-1 text-xs ${typedInvalid ? "text-destructive" : "text-muted-foreground"}`}>
          {typedInvalid ? PO_NUMBER_HINT : "The number is checked against Odoo."}
        </p>
      </div>
    </ModalShell>
  );
}

/**
 * Issue #549 — correcting the PO number on an Purchased item. The new number is
 * checked against Odoo like the first; PO lines picked on the old PO are cleared.
 */
export function CorrectPoDialog({ open, onOpenChange, item, requestId }) {
  const refresh = useRefreshRequest(requestId);
  const [poNumber, setPoNumber] = useState("");
  const po = normalizePoNumber(poNumber);
  const invalid = !po || !isValidPoNumber(po);

  const close = () => {
    setPoNumber("");
    onOpenChange(false);
  };

  const correctMutation = useMutation({
    mutationFn: () => purchaseRequestService.correctPo(item.id, po),
    onSuccess: (updated) => {
      toastPoVerdict(
        `${item.name}: PO ${updated?.po_number}: ${PO_VERIFICATION_LABELS[updated?.po_verification] || updated?.po_verification}.`,
        updated,
      );
      close();
    },
    onError: (error) => toast.error(refusal(error)),
    onSettled: refresh,
  });
  const busy = correctMutation.isPending;

  return (
    <ModalShell
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      className={OVER_REQUEST_MODAL}
      crumbs={["Purchase Requests", "Correct PO"]}
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid && !busy) correctMutation.mutate();
      }}
      actions={
        <Button size="lg" type="submit" disabled={invalid || busy}>
          {busy && <Spinner size="sm" />}
          Check PO and correct
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        {item.name}{item.po_number ? `, now on PO ${item.po_number}` : ", with no PO yet"}. The new number is checked against Odoo, and any PO line picked on the old PO is cleared.
      </p>
      <div className="space-y-1.5">
        <FieldBox label="New PO number" bare>
          <Input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="P01234" autoFocus />
        </FieldBox>
        <p className={`pl-1 text-xs ${poNumber && invalid ? "text-destructive" : "text-muted-foreground"}`}>
          {PO_NUMBER_HINT}
        </p>
      </div>
    </ModalShell>
  );
}

/**
 * Issue #312 — picking the Odoo PO line(s) an Purchased item is bought on, from
 * the lines its PO has on the IPAS stored Odoo copy (`lineIds`). The caller
 * only offers this when there are lines; the database refuses any other.
 */
export function PickPoLinesDialog({ open, onOpenChange, item, requestId, lineIds }) {
  const refresh = useRefreshRequest(requestId);
  const [picked, setPicked] = useState(() => new Set(item.odoo_po_line_ids || []));

  const toggle = (id, on) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const pickMutation = useMutation({
    mutationFn: (ids) => purchaseRequestService.pickPoLines(item.id, ids),
    onSuccess: () => {
      toast.success(`${item.name}: PO line picked.`);
      onOpenChange(false);
    },
    onError: (error) => toast.error(refusal(error)),
    onSettled: refresh,
  });

  const pickedIds = lineIds.filter((id) => picked.has(id));

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      className={OVER_REQUEST_MODAL}
      crumbs={["Purchase Requests", "Pick the PO line"]}
      actions={
        <Button
          size="lg"
          disabled={pickedIds.length === 0 || pickMutation.isPending}
          onClick={() => pickMutation.mutate(pickedIds)}
        >
          {pickMutation.isPending && <Spinner size="sm" />}
          {pickedIds.length > 1 ? `Pick ${pickedIds.length} lines` : "Pick line"}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        {item.name}, on PO {item.po_number}. The lines are from the PO&apos;s IPAS copy of Odoo.
      </p>
      <ul className="divide-y divide-border">
          {lineIds.map((id) => (
            <li key={id} className="py-2.5">
              <FieldBox inline className="gap-3">
                <Checkbox checked={picked.has(id)} onCheckedChange={(on) => toggle(id, on)} />
                <span className="text-sm font-semibold text-foreground">PO line {id}</span>
              </FieldBox>
            </li>
          ))}
      </ul>
    </ModalShell>
  );
}
