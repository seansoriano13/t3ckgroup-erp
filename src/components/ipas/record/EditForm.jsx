// The IPAS edit view (#581, prototype E: stepper + summaries): one long form
// with one Save. A sticky bar holds Back, how many required fields are filled,
// Next empty and Save all, with a stepper (Header, then 1 to 7) under it. Each
// section is a card; a finished one folds to one line. Everything is typed in
// place and stored together, the money too (payments, freight, charges,
// documents, bank details, status and spread). Only the sign-offs stay
// buttons: signing is an action, not a field.

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronDown } from "lucide-react";

import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { FieldBox } from "@/components/ui/FieldBox";
import { CHROME, RecordSectionChrome } from "@/components/record/sectionChrome";
import { cn } from "@/lib/utils";
import {
  IPAS_OPTION_LIST,
  IPAS_OVERRIDE,
  IPAS_PRIORITY_LABELS,
  IPAS_PURPOSE_LABELS,
  IPAS_SOURCE_LABELS,
  IPAS_SUPPLIER_ORIGIN_FIELDS,
} from "@/constants/ipas";
import { optionsForPicker } from "@/utils/ipasPayments";
import { formatDate } from "@/utils/formatDate.js";
import { Embedded, Field, GroupTitle, PickField, ReadValue, Tick } from "./FormFields";
import { GRID, focusField, reducedMotion } from "./formHelpers";
import { BankFields, ChargesFields, CostingFields, DocumentsFields, FreightField, PaymentsFields } from "./MoneyFields";
import {
  FORM_SECTIONS,
  actualCheckingStampable,
  changeCount,
  formFromIpas,
  missingFields,
  planIsEmpty,
  planSave,
  sectionProgress,
} from "./editFormModel";

const NUMBERED = /^(d+) · /;

/** The typed sections' bodies: `form` and `set(key, value)` come from the form. */
function SectionBody({ sectionKey, ipas, form, set, blocks, disabled, onEditPurpose, money }) {
  const odoo = (key) => ipas.overrides?.[key]?.odoo;
  switch (sectionKey) {
    case "header":
      return (
        <div className="space-y-4">
          <div className={GRID}>
            <ReadValue label="PO">{ipas.po_number}</ReadValue>
            <Field id="f-entity" label="Entity" odoo={odoo(IPAS_OVERRIDE.ENTITY)} value={form.entity} disabled={disabled} onChange={(v) => set("entity", v)} />
            <ReadValue label="Priority">{IPAS_PRIORITY_LABELS[ipas.priority]}</ReadValue>
            <ReadValue label="Source">{IPAS_SOURCE_LABELS[ipas.source]}</ReadValue>
            <ReadValue label="Date created">{formatDate(ipas.created_at)}</ReadValue>
            <ReadValue label="Created by">{ipas.creator?.name}</ReadValue>
          </div>
          <Field
            id="f-remarks"
            label="Remarks"
            kind="textarea"
            placeholder="Anything the next person should know"
            value={form.remarks}
            disabled={disabled}
            onChange={(v) => set("remarks", v)}
          />
        </div>
      );
    case "purchasing":
      return (
        <div className="space-y-6">
          <div className="space-y-3">
            <GroupTitle>Supplier and P.I</GroupTitle>
            <div className={GRID}>
              <ReadValue label="Supplier" odoo>
                {ipas.supplier}
              </ReadValue>
              <Field id="f-contact" label="Supplier's name" required value={form.contact} disabled={disabled} onChange={(v) => set("contact", v)} />
              <Field id="f-piNumber" label="P.I #" required value={form.piNumber} disabled={disabled} onChange={(v) => set("piNumber", v)} />
              <Field
                id="f-piQtAmount"
                label="P.I/QT Amount"
                kind="amount"
                prefix={(ipas.currency || "PHP").toString().toUpperCase()}
                required
                value={form.piQtAmount}
                disabled={disabled}
                onChange={(v) => set("piQtAmount", v)}
              />
              <FreightField ipas={ipas} form={form} set={set} disabled={disabled} />
            </div>
          </div>
          <PaymentsFields
            ipas={ipas}
            form={form}
            rows={money.rows}
            fresh={money.fresh}
            canRecord={money.can.record}
            onRemoveSaved={money.onRemoveSaved}
          />
          <Embedded>{blocks.signoffs1}</Embedded>
        </div>
      );
    case "finance":
      return (
        <div className="space-y-6">
          <ChargesFields
            ipas={ipas}
            form={form}
            rows={money.rows}
            fresh={money.fresh}
            canRecord={money.can.record}
            onRemoveSaved={money.onRemoveSaved}
          />
          <DocumentsFields
            ipas={ipas}
            form={form}
            rows={money.rows}
            fresh={money.fresh}
            canChange={money.can.change}
            canTickFinance={money.can.tickFinance}
            onRemoveSaved={money.onRemoveDocument}
            onSuggest={money.onSuggest}
          />
          <BankFields ipas={ipas} form={form} set={set} canChange={money.can.change} />
          <Embedded>{blocks.signoffs3}</Embedded>
        </div>
      );
    case "costing":
      return (
        <Embedded>
          <CostingFields ipas={ipas} form={form} set={set} canChange={money.can.change} canSetStatus={money.can.setStatus} />
        </Embedded>
      );
    case "filing":
      return <Embedded>{blocks.filing}</Embedded>;
    case "sales":
      return (
        <div className={GRID}>
          <ReadValue label="Purpose">{IPAS_PURPOSE_LABELS[ipas.purpose]}</ReadValue>
          <div className="min-w-0">
            <div className="pl-1 text-label font-bold tracking-widest text-muted-foreground uppercase">SORs</div>
            {ipas.sors.length === 0 ? (
              <p className="mt-1.5 pl-1 text-sm text-muted-foreground">
                {ipas.isProject ? "No SOR named" : `None; ${IPAS_PURPOSE_LABELS[ipas.purpose]} names no SOR`}
              </p>
            ) : (
              <ul className="mt-1.5 space-y-0.5 pl-1 text-sm">
                {ipas.sors.map((sor) => (
                  <li key={sor.id}>
                    <span className="font-mono font-semibold">{sor.salesReference}</span>
                    <span className="text-muted-foreground"> · {sor.projectTitle}</span>
                  </li>
                ))}
              </ul>
            )}
            {onEditPurpose && !disabled && (
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={onEditPurpose}>
                Change purpose and SORs
              </Button>
            )}
          </div>
          <Field id="f-sourceDoc" label="Source Doc. Odoo" odoo={odoo(IPAS_OVERRIDE.SOURCE_DOC)} value={form.sourceDoc} disabled={disabled} onChange={(v) => set("sourceDoc", v)} />
          <Field id="f-analytic" label="Analytic Dist." odoo={odoo(IPAS_OVERRIDE.ANALYTIC)} value={form.analytic} disabled={disabled} onChange={(v) => set("analytic", v)} />
          <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-1">
            <FieldBox label="Planning" />
            <div className="flex flex-wrap gap-2">
              <Tick label="Googlesheet" checked={form.googleSheet} disabled={disabled} onChange={(v) => set("googleSheet", v)} />
              <Tick label="Gantt Chart" checked={form.ganttChart} disabled={disabled} onChange={(v) => set("ganttChart", v)} />
            </div>
          </div>
        </div>
      );
    case "logistics": {
      const options = optionsForPicker(ipas.options ?? [], IPAS_OPTION_LIST.ITEM_LOCATION, ipas.item_location_id).map((option) => ({
        value: option.id,
        label: option.active ? option.label : `${option.label} (deactivated)`,
      }));
      return (
        <div className={GRID}>
          <PickField
            id="f-location"
            label="Item Location"
            required
            options={options}
            value={form.location}
            emptyLabel="Not set"
            disabled={disabled}
            onChange={(value) => set("location", value)}
            hint={ipas.itemLocation?.label ? `The Transmittals say ${ipas.itemLocation.label}. Pick one to keep it on this IPAS.` : undefined}
          />
        </div>
      );
    }
    case "status": {
      const date = (key, label) => <Field key={key} id={`f-${key}`} label={label} kind="date" value={form[key]} disabled={disabled} onChange={(v) => set(key, v)} />;
      const stampable = actualCheckingStampable(ipas);
      const isImport = Boolean(ipas.supplierOrigin);
      return (
        <div className="space-y-5">
          {isImport && (
            <div className="space-y-3">
              <GroupTitle>Supplier Origin</GroupTitle>
              <div className={GRID}>{IPAS_SUPPLIER_ORIGIN_FIELDS.map(({ field, label }) => date(field, label))}</div>
            </div>
          )}
          <div className="space-y-3">
            <GroupTitle>Buyer track</GroupTitle>
            <p className="text-xs text-muted-foreground">Purchase Order, Received in Odoo and Create Bill come from Odoo, so they are not typed.</p>
            <div className={GRID}>
              {isImport && date("importClearance", "Import Clearance")}
              {date("delivered", "Delivered")}
              <div className="flex flex-col gap-1.5">
                <FieldBox label="Actual Checking" />
                <Tick label="Checked on site" checked={form.actualChecking} disabled={disabled || !stampable} onChange={(v) => set("actualChecking", v)} />
              </div>
            </div>
          </div>
        </div>
      );
    }
    default:
      return null;
  }
}

const LISTS = ["payments", "charges", "documents"];
const emptyRows = () => ({ payments: {}, charges: {}, documents: {} });
const emptyAdded = () => ({ payments: [], charges: [], documents: [] });

/**
 * `blocks` holds the sign-off and filing bodies (signoffs1, signoffs3, filing); the rest is typed here.
 * `can` is what this person may type: { change, record, tickFinance, setStatus(from, to) }.
 * `onSave(plan)` stores the typed changes and resolves when they are in (a failure carries
 * `doneKeys`, the new or changed rows already stored); `onBack()` leaves.
 */
export default function EditForm({
  ipas,
  blocks,
  can,
  canSave,
  savedCount = 0,
  focusKey,
  saving,
  onSave,
  onBack,
  onEditPurpose,
  failure,
  notice,
  onRemoveSaved,
  onRemoveDocument,
  onSuggest,
}) {
  const canChange = can.change;
  const base = useMemo(() => formFromIpas(ipas), [ipas]);
  const [edits, setEdits] = useState({});
  // Money rows: saved rows typed over, and new rows not stored yet.
  const [rowEdits, setRowEdits] = useState(emptyRows);
  const [added, setAdded] = useState(emptyAdded);
  const [fresh, setFresh] = useState(null);
  const [saved, setSaved] = useState(false);
  const form = { ...base, ...edits };
  for (const list of LISTS) form[list] = [...base[list].map((row) => rowEdits[list][row.key] ?? row), ...added[list]];
  const set = (key, value) =>
    setEdits((current) => {
      const next = { ...current };
      if (value === base[key]) delete next[key];
      else next[key] = value;
      return next;
    });

  const rows = {
    add: (list, draft) => {
      setAdded((current) => ({ ...current, [list]: [...current[list], draft] }));
      setFresh(draft.key);
      setSaved(false);
    },
    patch: (list, key, patch) => {
      if (added[list].some((row) => row.key === key)) {
        setAdded((current) => ({ ...current, [list]: current[list].map((row) => (row.key === key ? { ...row, ...patch } : row)) }));
        return;
      }
      setRowEdits((current) => {
        const stored = base[list].find((row) => row.key === key);
        const row = { ...(current[list][key] ?? stored), ...patch };
        const next = { ...current[list] };
        if (JSON.stringify(row) === JSON.stringify(stored)) delete next[key];
        else next[key] = row;
        return { ...current, [list]: next };
      });
    },
    drop: (list, key) => setAdded((current) => ({ ...current, [list]: current[list].filter((row) => row.key !== key) })),
  };
  // A save finished (even a Retry from the page's notice): what was typed is stored now.
  const [seenSaves, setSeenSaves] = useState(savedCount);
  if (seenSaves !== savedCount) {
    setSeenSaves(savedCount);
    setEdits({});
    setRowEdits(emptyRows());
    setAdded(emptyAdded());
    setSaved(true);
  }
  // The ease-in is for the moment a row is added only.
  useEffect(() => {
    if (!fresh) return undefined;
    const timer = setTimeout(() => setFresh(null), 1200);
    return () => clearTimeout(timer);
  }, [fresh]);

  const progress = sectionProgress(form);
  const missing = missingFields(form);
  const changed = changeCount(form, base);
  const total = progress.reduce((n, p) => n + p.total, 0);
  const done = progress.reduce((n, p) => n + p.done, 0);
  const cards = useRef({});
  const [opened, setOpened] = useState({});
  const [discarding, setDiscarding] = useState(false);
  const [planError, setPlanError] = useState(null);

  const isOpen = (p) => opened[p.key] ?? (p.left > 0 || p.key === focusKey);
  const scrollTo = (key) =>
    requestAnimationFrame(() => cards.current[key]?.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" }));
  const go = (key) => {
    setOpened((o) => ({ ...o, [key]: true }));
    scrollTo(key);
  };

  // Deep link: the section named in ?edit= is open and in view on arrival.
  useEffect(() => {
    if (focusKey) scrollTo(focusKey);
  }, [focusKey]);

  const nextEmpty = () => {
    const first = missing[0];
    if (!first) return;
    setOpened((o) => ({ ...o, [first.section]: true }));
    requestAnimationFrame(() => focusField(first.id));
  };

  const save = async () => {
    const plan = planSave(form, base);
    if (plan.error) {
      setPlanError(plan.error);
      return;
    }
    setPlanError(null);
    if (planIsEmpty(plan)) return;
    try {
      await onSave(plan);
      setEdits({});
      setRowEdits(emptyRows());
      setAdded(emptyAdded());
      setSaved(true);
    } catch (error) {
      // The page keeps the failure with Retry; what was typed stays, except the rows that
      // did get stored before the failure: they are on the IPAS now, so they leave the form.
      const stored = new Set(error?.doneKeys ?? []);
      if (stored.size > 0) {
        setAdded((current) => Object.fromEntries(LISTS.map((list) => [list, current[list].filter((row) => !stored.has(row.key))])));
        setRowEdits((current) =>
          Object.fromEntries(LISTS.map((list) => [list, Object.fromEntries(Object.entries(current[list]).filter(([key]) => !stored.has(key)))])),
        );
      }
    }
  };

  const back = () => (changed > 0 ? setDiscarding(true) : onBack());

  let status = null;
  if (saving) status = "Saving…";
  else if (changed > 0) status = `${changed} unsaved ${changed === 1 ? "change" : "changes"}`;
  else if (saved) status = "All changes saved";

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-20 -mx-1 rounded-2xl border border-border bg-card/95 p-3 shadow-sm backdrop-blur">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={back}>
            <ArrowLeft size={14} aria-hidden="true" />
            Back to preview
          </Button>
          <span className="text-sm text-muted-foreground tabular-nums">
            {done} of {total} required fields filled
          </span>
          <span role="status" aria-live="polite" className={cn("text-sm tabular-nums", changed > 0 ? "text-amber-11" : "text-green-11")}>
            {status}
          </span>
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={!missing.length} onClick={nextEmpty}>
              Next empty
            </Button>
            <Button type="button" size="sm" disabled={!canSave || saving || changed === 0} onClick={save}>
              Save all{changed ? ` (${changed})` : ""}
            </Button>
          </div>
        </div>
        {planError && (
          <div role="alert" className="mb-2 text-sm text-red-11">
            {planError}
          </div>
        )}
        {notice}
        {failure}
        <ol className="flex gap-1 overflow-x-auto">
          {progress.map((p) => {
            const complete = p.total > 0 && p.left === 0;
            const no = p.title.match(NUMBERED)?.[1];
            return (
              <li key={p.key} className="min-w-[8.5rem] flex-1">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => go(p.key)}
                  className="h-auto w-full min-w-0 justify-start gap-2 rounded-xl px-2 py-1.5 text-left whitespace-normal"
                >
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                      complete ? "bg-green-9 text-white" : p.total === 0 ? "bg-muted text-muted-foreground" : "bg-amber-3 text-amber-11",
                    )}
                  >
                    {complete ? <Check size={13} /> : (no ?? "H")}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold text-foreground" title={p.title}>
                      {p.title.replace(NUMBERED, "")}
                    </span>
                    <span className="block text-[11px] text-muted-foreground tabular-nums">
                      {p.total === 0 ? "optional" : complete ? "Complete" : `${p.done}/${p.total}`}
                    </span>
                  </span>
                </Button>
              </li>
            );
          })}
        </ol>
      </div>

      {FORM_SECTIONS.map((section) => {
        const p = progress.find((x) => x.key === section.key);
        const complete = p.total > 0 && p.left === 0;
        const open = isOpen(p);
        const bodyId = `edit-body-${section.key}`;
        return (
          <section
            key={section.key}
            id={`edit-${section.key}`}
            aria-label={section.title}
            ref={(el) => (cards.current[section.key] = el)}
            className={cn("scroll-mt-32 rounded-2xl border bg-card", complete ? "border-green-a5" : "border-border")}
          >
            <Button
              type="button"
              variant="ghost"
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={() => setOpened((o) => ({ ...o, [section.key]: !open }))}
              className="h-auto w-full justify-between gap-3 rounded-2xl p-5 text-left whitespace-normal"
            >
              <span className="min-w-0">
                <span className="block text-lg font-black text-foreground">{section.title}</span>
                <span className="block text-sm text-muted-foreground">
                  {!open && complete ? `All ${p.total} required fields filled. Tap to review.` : section.hint}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {p.total > 0 && (
                  <span className={cn("text-xs font-medium tabular-nums", complete ? "text-green-11" : "text-muted-foreground")}>
                    {complete ? "Complete" : `${p.left} to fill`}
                  </span>
                )}
                <ChevronDown size={16} className={cn("transition-transform", open && "rotate-180")} aria-hidden="true" />
              </span>
            </Button>
            {open && (
              <div
                id={bodyId}
                className="mx-5 border-t border-border pt-6 pb-5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-200"
              >
                <SectionBody
                  sectionKey={section.key}
                  ipas={ipas}
                  form={form}
                  set={set}
                  blocks={blocks}
                  disabled={!canChange}
                  onEditPurpose={onEditPurpose}
                  money={{ rows, fresh, can, onRemoveSaved, onRemoveDocument, onSuggest }}
                />
              </div>
            )}
          </section>
        );
      })}

      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title="Leave without saving?"
        description={`You have ${changed} unsaved ${changed === 1 ? "change" : "changes"}. They will be lost.`}
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        tone="destructive"
        onConfirm={onBack}
      />
    </div>
  );
}
