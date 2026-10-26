/**
 * REMOVE-BEFORE-PROD (ADR 0028): the dialogs of the Product status
 * prototype. Real ModalShell, FieldBox, Input, SelectField and LinerList;
 * nothing is sent anywhere.
 */
import { useState } from "react";
import { ImagePlus, X } from "lucide-react";

import DetailGrid from "@/components/record/DetailGrid";
import LinerList from "@/components/record/LinerList";
import StatusBadge from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { FieldBox } from "@/components/ui/FieldBox";
import { Image } from "@/components/ui/image";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/SelectField";
import { Textarea } from "@/components/ui/textarea";
import ModalShell from "@/components/ui/ModalShell";
import { STATUS_THEME } from "@/constants/statusTheme";
import { ODOO_P0S, PROJECT, REPLACEMENT_PRODUCTS, photoSrc } from "./data";
import { StatusPill } from "./LineStatus";
import { STATUS, deliveryNote, p0FromOdoo, peso } from "./lineState";

const FOR_OPTIONS = [
  { value: "For the client", label: "For the client" },
  { value: "Material for the job", label: "Material for the job" },
];

const SAMPLE_PHOTOS = [photoSrc("photo 1", 30), photoSrc("photo 2", 160), photoSrc("photo 3", 280), photoSrc("photo 4", 340)];

const P0_SHAPE = /^P0\d{4,6}$/;

/** A typed P0 number: found in the example Odoo list, or treated as a confirmed P0 for the same product. */
function resolveTyped(text, line) {
  const number = text.trim().toUpperCase();
  if (!number) return { empty: true };
  if (!P0_SHAPE.test(number)) return { invalid: true };
  const known = ODOO_P0S.find((p) => p.number === number);
  if (known) return { p0: p0FromOdoo(known), note: `Found in Odoo: ${known.number} · ${known.state === "RFQ" ? "RFQ" : "Confirmed"} · ${known.product}.` };
  return {
    p0: { number, state: "Confirmed", product: line.name, price: null, eta: null, received: 0, of: line.qty },
    note: "This number is not in the example data, so the prototype treats it as a confirmed P0 with no ETA.",
  };
}

/** + Ask for a product: what you need in your own words. It lands in Other requests as Not checked. */
export function AskDialog({ open, onOpenChange, onSave }) {
  const [text, setText] = useState("");
  const [qty, setQty] = useState("1");
  const [forWhat, setForWhat] = useState(FOR_OPTIONS[0].value);
  const [photos, setPhotos] = useState([]);
  const valid = text.trim() !== "" && Number(qty) > 0;

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      crumbs={["Purchase Request", "Ask for a product"]}
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSave({ text: text.trim(), qty: Number(qty), forWhat, photos });
      }}
      actions={
        <Button size="lg" type="submit" disabled={!valid}>
          Send request
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        Tell us what you need in your own words. Purchasing will find the product. It shows under Other requests as Not checked.
      </p>
      <div className="space-y-4">
        <FieldBox bare label="What do you need?">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            placeholder="e.g. A heavy-duty tarpaulin, about 6 by 8 metres, green"
            autoFocus
          />
        </FieldBox>
        <div className="grid grid-cols-2 gap-3">
          <FieldBox bare label="Quantity">
            <Input type="number" min="1" step="1" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
          </FieldBox>
          <FieldBox bare label="What is it for?">
            <SelectField className="w-full" options={FOR_OPTIONS} value={forWhat} onChange={setForWhat} />
          </FieldBox>
        </div>
        <div className="space-y-2">
          <FieldBox label="Photos (optional)" />
          <div className="flex flex-wrap items-center gap-2">
            {photos.map((src, i) => (
              <span key={src} className="relative">
                <Image src={src} alt={`Example photo ${i + 1}`} className="size-14 rounded-lg border border-border object-cover" />
                <Button
                  type="button"
                  variant="outline"
                  size="icon-xs"
                  aria-label={`Remove photo ${i + 1}`}
                  onClick={() => setPhotos((prev) => prev.filter((p) => p !== src))}
                  className="absolute -top-2 -right-2 size-5 rounded-full"
                >
                  <X size={10} />
                </Button>
              </span>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={photos.length >= SAMPLE_PHOTOS.length}
              onClick={() => setPhotos((prev) => [...prev, SAMPLE_PHOTOS[prev.length]])}
            >
              <ImagePlus size={14} />
              Add a photo
            </Button>
          </div>
          <p className="pl-1 text-xs text-muted-foreground">In this preview, a photo is a stand-in picture.</p>
        </div>
      </div>
    </ModalShell>
  );
}

function p0Row({ p0, onPick }) {
  return {
    key: p0.number,
    testId: "p0-suggestion",
    label: p0.number,
    main: `${p0.number} · ${p0.product}`,
    sub: `${p0.code ? `[${p0.code}] · ` : ""}×${p0.qty} · ${peso(p0.price)} each · ${p0.eta ? `ETA ${p0.eta}` : "no ETA set"} · Source Document ${p0.source}`,
    subWrap: true,
    actions: (
      <div className="flex items-center gap-2">
        <StatusBadge label={p0.state === "RFQ" ? "RFQ" : "Confirmed"} theme={p0.state === "RFQ" ? STATUS_THEME.AMBER : STATUS_THEME.BLUE} />
        <Button type="button" variant="outline" size="sm" onClick={() => onPick(p0)}>
          Use this P0
        </Button>
      </div>
    ),
  };
}

/** Attach P0 (Purchasing): suggested P0s first, then the other P0s that name the same source, then a typed number. */
export function AttachP0Dialog({ open, onOpenChange, line, onAttach }) {
  const [typed, setTyped] = useState("");
  const source = line.section === "sor" ? PROJECT.s0 : PROJECT.request;
  const named = ODOO_P0S.filter((p) => p.source === source);
  const suggested = named.filter((p) => p.forId === line.id);
  const others = named.filter((p) => p.forId !== line.id);
  const result = resolveTyped(typed, line);
  const pick = (row) => onAttach(p0FromOdoo(row));

  return (
    <ModalShell open={open} onOpenChange={onOpenChange} crumbs={["Purchase Request", "Attach P0"]}>
      <p className="text-sm text-muted-foreground">
        {line.name}. An RFQ keeps the line at To purchase. A confirmed P0 makes it Purchased.
      </p>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Suggested from Odoo</h3>
        <p className="text-xs text-muted-foreground">Their Source Document names {source} and they list the same product.</p>
        <LinerList label="Suggested P0s" rows={suggested.map((p) => p0Row({ p0: p, onPick: pick }))} empty="No P0 in Odoo lists this product yet." />
      </section>
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Other P0s that name {source}</h3>
        <p className="text-xs text-muted-foreground">Different products. The line will say what was bought instead.</p>
        <LinerList label="Other P0s" rows={others.map((p) => p0Row({ p0: p, onPick: pick }))} empty="No other P0s name it." />
      </section>
      <section className="space-y-1.5">
        <div className="flex items-end gap-2">
          <FieldBox bare label="Or type a P0 number" className="flex-1">
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="P09744" />
          </FieldBox>
          <Button type="button" size="lg" disabled={!result.p0} onClick={() => onAttach(result.p0)}>
            Attach
          </Button>
        </div>
        <p className={`pl-1 text-xs ${result.invalid ? "text-destructive" : "text-muted-foreground"}`}>
          {result.invalid ? "A P0 number looks like P09744." : (result.note ?? "The number is checked against Odoo.")}
        </p>
      </section>
    </ModalShell>
  );
}

/** Replace (Purchasing): the new product, an optional P0 for it, and a required reason. */
export function ReplaceDialog({ open, onOpenChange, line, onReplace }) {
  const [picked, setPicked] = useState("");
  const [typedName, setTypedName] = useState("");
  const [p0Text, setP0Text] = useState("");
  const [reason, setReason] = useState("");

  const product = REPLACEMENT_PRODUCTS.find((p) => p.value === picked);
  const newName = typedName.trim() || product?.name || "";
  const result = resolveTyped(p0Text, { ...line, name: newName });
  const valid = newName !== "" && reason.trim() !== "" && !result.invalid;

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      crumbs={["Purchase Request", "Replace product"]}
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onReplace({ newName, newCode: typedName.trim() ? null : product?.code, p0: result.p0 ?? null, reason: reason.trim() });
      }}
      actions={
        <Button size="lg" type="submit" disabled={!valid}>
          Replace product
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        {line.name} will be cancelled and its Canvass stopped. The new product appears under Other requests.
      </p>
      <div className="space-y-4">
        <FieldBox bare label="Pick the new product from Odoo">
          <SelectField
            className="w-full"
            options={REPLACEMENT_PRODUCTS.map((p) => ({ value: p.value, label: `${p.name} [${p.code}]` }))}
            value={picked}
            onChange={setPicked}
            placeholder="Choose a product"
          />
        </FieldBox>
        <FieldBox bare label="Or type the new product">
          <Input value={typedName} onChange={(e) => setTypedName(e.target.value)} placeholder="e.g. STIHL telescopic pole pruner" />
        </FieldBox>
        <div className="space-y-1.5">
          <FieldBox bare label="P0 for the new product (optional)">
            <Input value={p0Text} onChange={(e) => setP0Text(e.target.value)} placeholder="P09744" />
          </FieldBox>
          <p className={`pl-1 text-xs ${result.invalid ? "text-destructive" : "text-muted-foreground"}`}>
            {result.invalid ? "A P0 number looks like P09744." : (result.note ?? "Leave it empty if there is no P0 yet.")}
          </p>
        </div>
        <FieldBox bare label="Why is it being replaced? (required)">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="e.g. Technical advised the HT 133 instead" />
        </FieldBox>
      </div>
    </ModalShell>
  );
}

/** "Is this yours?": the S0 line beside the request that may be the same product. */
export function YoursDialog({ open, onOpenChange, sorLine, request, onYes, onNo }) {
  const delivery = deliveryNote(request.p0);
  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      crumbs={["Purchase Request", "Is this from your purchase request?"]}
      title="Is this from your purchase request?"
      cancelLabel={null}
      actions={
        <>
          <Button type="button" variant="outline" size="lg" onClick={onNo}>
            No, they are different
          </Button>
          <Button type="button" size="lg" onClick={onYes}>
            Yes, same product
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <section className="space-y-3 rounded-xl border border-border p-4" aria-label="New on the S0">
          <h3 className="text-sm font-semibold text-foreground">New on the S0</h3>
          <DetailGrid
            min="8rem"
            items={[
              { label: "Product", value: sorLine.name },
              { label: "Odoo code", value: sorLine.code, mono: true },
              { label: "Quantity", value: `×${sorLine.qty}` },
            ]}
          />
        </section>
        <section className="space-y-3 rounded-xl border border-border p-4" aria-label="Your request">
          <h3 className="text-sm font-semibold text-foreground">Your request</h3>
          <div className="flex gap-3">
            {request.photo && <Image src={request.photo} alt="Photo on your request" className="size-16 shrink-0 rounded-lg border border-border object-cover" />}
            <p className="min-w-0 text-[13px] font-medium text-foreground">{request.name}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <StatusPill status={STATUS.PURCHASED} />
            <span className="font-mono text-foreground">{request.p0.number}</span>
          </div>
          {delivery && <p className="text-xs text-muted-foreground">{delivery}</p>}
        </section>
      </div>
      <p className="text-xs text-muted-foreground">
        Yes moves {request.p0.number} and its delivery onto the S0 line, and closes the request. Nothing is deleted.
      </p>
    </ModalShell>
  );
}
