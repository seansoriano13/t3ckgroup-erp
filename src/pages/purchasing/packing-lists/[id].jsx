import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Check, Pencil, Plus, Printer, Trash2 } from "lucide-react";
import { openPackingListPrintWindow, printPackingList } from "../../../lib/pdf/packingListPrinter";

import ProtectedRoute from "../../../components/ProtectedRoute";
import { Button } from "../../../components/ui/button";
import ModalShell from "../../../components/ui/ModalShell";
import PageLoading from "../../../components/ui/PageLoading";
import EmptyState from "../../../components/ui/EmptyState";
import QueryError from "../../../components/ui/QueryError";
import { FieldBox } from "../../../components/ui/FieldBox";
import { Input } from "../../../components/ui/input";
import { SelectField } from "../../../components/ui/SelectField";
import MoveButton from "../../../components/record/MoveButton";
import StepMark from "../../../components/record/StepMark";
import { StateWord } from "../../../components/record/StateMark";
import { CHROME } from "../../../components/record/sectionChrome";
import { useMoveConfirm } from "../../../components/record/useMoveConfirm";
import SectionTitle from "../../../components/transmittals/SectionTitle";
import RecordMoreMenu from "../../../components/record/RecordMoreMenu";
import { STATE } from "../../../components/record/statePalette";
import { useAuth } from "../../../context/AuthContext";
import { getPermissionContext } from "../../../utils/permissions";
import { packingListService, sorLineSnapshot } from "../../../services/packingListService";
import { ipasErrorMessage } from "../../../utils/ipas";
import PackingListsPage from "./index";

const LIST_PATH = "/purchasing/packing-lists";

/**
 * One Packing List (#255, spec #251) as a modal over the Packing Lists list, laid out like the IPAS record page (#538):
 * Details, Boxes (marks, seal and weight, and each box's contents, typed or
 * picked from the SOR's Product List) and Packed by. Signing Packed by closes
 * it, from the card or the drawer's bottom bar; a packed list shows read-only.
 */

const KEY = (id) => ["packing-list", id];

const blank = { description: "", quantity: "", unit: "" };

function BoxDialog({ open, onOpenChange, box, listId, onSaved }) {
  const [marks, setMarks] = useState(box?.marks ?? "");
  const [sealNo, setSealNo] = useState(box?.sealNo ?? "");
  const [weight, setWeight] = useState(box?.grossWeightKg ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const fields = {
        marks: marks.trim() || null,
        sealNo: sealNo.trim() || null,
        grossWeightKg: weight === "" ? null : Number(weight),
      };
      if (box) await packingListService.updateBox(box.id, fields);
      else await packingListService.addBox(listId, fields);
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(ipasErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      crumbs={["Packing List", box ? `Box ${box.boxNo}` : "Add a box"]}
      actions={
        <Button size="lg" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save box"}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">Marks, seal number and gross weight, where known.</p>
        <div className="space-y-4">
          <FieldBox label="Marks" bare>
            <Input value={marks} onChange={(e) => setMarks(e.target.value)} />
          </FieldBox>
          <FieldBox label="Seal number" bare>
            <Input value={sealNo} onChange={(e) => setSealNo(e.target.value)} />
          </FieldBox>
          <FieldBox label="Gross weight (kg)" bare>
            <Input type="number" min="0" step="0.01" value={weight} onChange={(e) => setWeight(e.target.value)} />
          </FieldBox>
        </div>
    </ModalShell>
  );
}

function seedRows(box) {
  if (!box) return [];
  return box.contents.length
    ? box.contents.map((c) => ({
        description: c.description,
        quantity: String(c.quantity),
        unit: c.unit ?? "",
        snapshot: c.snapshot,
      }))
    : [{ ...blank }];
}

function ContentsDialog({ open, onOpenChange, box, sorId, onSaved }) {
  // Mounted only while a box's contents are open, so the rows start from the box as it is now.
  const [rows, setRows] = useState(() => seedRows(box));
  const [saving, setSaving] = useState(false);

  // Loaded when the dialog opens: the SOR's Product List to pick from, and the
  // box's current contents as editable rows.
  const { data: productList = [] } = useQuery({
    queryKey: ["sor-product-list", sorId],
    queryFn: () => packingListService.sorProducts(sorId),
    enabled: open && Boolean(sorId),
  });


  const setRow = (index, patch) => setRows((current) => current.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const pick = (index, lineId) => {
    const line = productList.find((l) => String(l.id) === lineId);
    if (!line) return;
    setRow(index, {
      description: line.product_name,
      quantity: String(line.quantity ?? ""),
      unit: line.unit ?? "",
      snapshot: sorLineSnapshot(line),
    });
  };

  const save = async () => {
    const contents = rows
      .filter((r) => r.description.trim())
      .map((r) => ({
        description: r.description.trim(),
        quantity: Number(r.quantity),
        unit: r.unit.trim() || null,
        snapshot: r.snapshot ?? null,
      }));
    if (contents.some((c) => !(c.quantity > 0))) {
      toast.error("Every content needs a quantity above zero.");
      return;
    }
    setSaving(true);
    try {
      await packingListService.setContents(box.id, contents);
      onOpenChange(false);
      onSaved();
    } catch (error) {
      toast.error(ipasErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      expandable
      crumbs={["Packing List", `Box ${box?.boxNo}`, "Contents"]}
      actions={
        <Button size="lg" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save contents"}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">Type each content, or pick it from the SOR's Product List (copied as it is now).</p>
        <div className="space-y-3">
          {rows.map((row, index) => (
            <div key={index} className="grid grid-cols-1 gap-2 md:grid-cols-[2fr_1fr_1fr_auto] md:items-end">
              <FieldBox label="Description" bare>
                <Input value={row.description} onChange={(e) => setRow(index, { description: e.target.value, snapshot: null })} />
              </FieldBox>
              <FieldBox label="Quantity" bare>
                <Input type="number" min="0" step="any" value={row.quantity} onChange={(e) => setRow(index, { quantity: e.target.value })} />
              </FieldBox>
              <FieldBox label="Unit" bare>
                <Input value={row.unit} onChange={(e) => setRow(index, { unit: e.target.value })} />
              </FieldBox>
              <Button variant="ghost" size="icon" aria-label="Remove content" onClick={() => setRows((r) => r.filter((_, i) => i !== index))}>
                <Trash2 size={14} />
              </Button>
              {productList.length > 0 && (
                <div className="md:col-span-4">
                  <SelectField
                    options={productList.map((line) => ({
                      value: String(line.id),
                      label: `${line.product_name} · ${line.quantity} ${line.unit ?? ""}`,
                    }))}
                    value=""
                    onChange={(lineId) => pick(index, lineId)}
                    placeholder="Pick from the Product List…"
                    className="w-full"
                    aria-label="Pick from the Product List"
                  />
                </div>
              )}
            </div>
          ))}
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setRows((r) => [...r, { ...blank }])}>
            <Plus size={14} />
            Add a content
          </Button>
        </div>
    </ModalShell>
  );
}

const SECTION = { PACKED_BY: "packed_by" };

const formatWhen = (value) => (value ? new Date(value).toLocaleString() : "");

function PackingListPage({ onClose }) {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { hasPurchasingFlow, isSuperAdmin } = getPermissionContext(user);

  // `seq` remounts the box dialog on every open, so a new box starts blank.
  const [boxDialog, setBoxDialog] = useState({ open: false, box: null, seq: 0 });
  const [contentsBox, setContentsBox] = useState(null);
  const [packing, setPacking] = useState(false);
  const [failure, setFailure] = useState(null);

  const { data: list, isLoading, isError, refetch } = useQuery({
    queryKey: KEY(id),
    queryFn: () => packingListService.get(id),
    enabled: Boolean(id),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: KEY(id) });
    queryClient.invalidateQueries({ queryKey: ["packing-lists"] });
  };

  const removeBox = async (box) => {
    if (!window.confirm(`Remove box ${box.boxNo} and its contents?`)) return;
    try {
      await packingListService.removeBox(box.id);
      refresh();
    } catch (error) {
      toast.error(ipasErrorMessage(error));
    }
  };

  // The window opens in the click (popup blockers allow only that); the list loads into it.
  const printList = async () => {
    const printWindow = openPackingListPrintWindow();
    if (!printWindow) {
      toast.error("Popup blocked. Allow popups to print.");
      return;
    }
    try {
      await printPackingList(id, { printWindow });
    } catch (error) {
      toast.error(ipasErrorMessage(error));
    }
  };

  // Signing Packed by is one move, from the card or the drawer's bottom bar. A failure shows
  // where it was started, with Retry.
  const pack = async (from) => {
    setPacking(true);
    try {
      await packingListService.pack(id);
      setFailure(null);
      toast.success(`${list.number} packed`);
      refresh();
    } catch (error) {
      const message = ipasErrorMessage(error);
      toast.error(message);
      setFailure({
        key: "pack",
        origin: from?.origin,
        message,
        retry: () => pack(from),
        dismiss: () => setFailure(null),
      });
    } finally {
      setPacking(false);
    }
  };

  const draft = list?.state === "draft";
  const canEdit = draft && (hasPurchasingFlow || isSuperAdmin || list?.createdById === user?.id);

  const boxes = list?.boxes ?? [];
  const totalWeight = boxes.reduce((sum, box) => sum + (box.grossWeightKg ?? 0), 0);
  const weighed = boxes.filter((box) => box.grossWeightKg != null).length;
  const packed = Boolean(list) && !draft;

  const moves = [];
  if (list && canEdit) {
    moves.push({
      key: "pack",
      section: SECTION.PACKED_BY,
      kind: "approve",
      icon: Check,
      label: "Sign Packed by",
      verb: "Sign Packed by",
      confirm: boxes.length > 0,
      hint:
        boxes.length === 0
          ? "Add a box first."
          : "Closes the list. The boxes and their contents can't be changed after. Next: nobody.",
      run: (from) => (boxes.length === 0 ? setBoxDialog((s) => ({ open: true, box: null, seq: s.seq + 1 })) : pack(from)),
    });
  }
  const gates = [
    {
      key: SECTION.PACKED_BY,
      label: "Packed by",
      role: "Maker or Purchasing",
      done: packed,
      now: Boolean(list) && draft,
      state: packed ? STATE.DONE : draft ? STATE.CURRENT : STATE.WAITING,
      line: packed
        ? `Packed by ${list.packerName ?? "someone"}${list.packedAt ? ` · ${formatWhen(list.packedAt)}` : ""}`
        : "Waiting for the maker of the list or Purchasing",
      accessibleName: `Step 1, Packed by, Maker or Purchasing, ${packed ? "done" : draft ? "now" : "waiting"}`,
    },
  ];
  const status = !list
    ? ""
    : packed
      ? "Packed. Nothing left to do."
      : moves.length > 0
        ? "Waiting for you: Packed by"
        : "Nothing needs you right now. Waiting on the maker of the list or Purchasing for Packed by.";

  const facts = list
    ? [
        ["SOR", [list.sorReference, list.projectTitle].filter(Boolean).join(" · ")],
        ["Odoo delivery", list.odooDeliveryRef],
        ["Made by", list.creatorName],
        ["Boxes", boxes.length ? String(boxes.length) : ""],
        [
          "Weight",
          weighed > 0 ? `${totalWeight.toFixed(2)} kg${weighed < boxes.length ? ` (${weighed} of ${boxes.length} weighed)` : ""}` : "",
        ],
      ].filter(([, value]) => value)
    : [];

  const boxCards = (
    <div className="space-y-3">
      {boxes.length === 0 && <EmptyState title="No boxes yet" description="Add a box, then list what is in it." />}
      {boxes.map((box) => (
        <div key={box.id} className="rounded-2xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div className="text-[13px]">
              <span className="font-semibold">Box {box.boxNo}</span>
              <span className="text-muted-foreground">
                {" "}· Marks {box.marks ?? "—"} · Seal {box.sealNo ?? "—"} · {box.grossWeightKg == null ? "weight not known" : `${box.grossWeightKg} kg`}
              </span>
            </div>
            {canEdit && (
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setBoxDialog((s) => ({ open: true, box, seq: s.seq + 1 }))}>
                  <Pencil size={13} />
                  Box
                </Button>
                <Button variant="outline" size="sm" onClick={() => setContentsBox(box)}>
                  Contents
                </Button>
                <Button variant="ghost" size="icon" aria-label={`Remove box ${box.boxNo}`} onClick={() => removeBox(box)}>
                  <Trash2 size={14} />
                </Button>
              </div>
            )}
          </div>
          <ul className="divide-y divide-border">
            {box.contents.length === 0 && <li className="px-4 py-3 text-[13px] text-muted-foreground">No contents yet.</li>}
            {box.contents.map((c) => (
              <li key={c.id} className="px-4 py-2 text-[13px]">
                {c.quantity} {c.unit ?? ""} · {c.description}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );

  const restate = () => (list ? `Signs Packed by on ${list.number}. The boxes and their contents can't be changed after.` : "");

  const { run, dialog } = useMoveConfirm({ restate, viewer: user?.name, origin: CHROME.CARD });

  return (
    <ModalShell
      open
      onOpenChange={(next) => !next && onClose()}
      size="wide"
      expandable
      cancelLabel="Close"
      crumbs={["Packing List", list?.number].filter(Boolean)}
      headerActions={list && <RecordMoreMenu items={[{ key: "print", label: "Print", icon: Printer, onSelect: printList }]} />}
    >
      {list && (
        <p className="text-sm text-muted-foreground">
          {`${list.sorReference ?? ""}${list.projectTitle ? ` · ${list.projectTitle}` : ""}`}
        </p>
      )}
      {isLoading && <PageLoading label="Packing List" />}
      {isError && <QueryError title="This Packing List could not be loaded." onRetry={refetch} />}
      {!isLoading && !isError && !list && (
        <EmptyState title="Not found" description="This Packing List doesn't exist, or you can't read it." />
      )}

      {list && (
        <>
          <div className="grid gap-8 pb-2 xl:grid-cols-[minmax(0,1fr)_25rem]">
            <div className="min-w-0 space-y-8">
              <div className="flex flex-wrap gap-2">
                {facts.map(([label, value]) => (
                  <span key={label} className="inline-flex max-w-full items-baseline gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-[13px]">
                    <span className="shrink-0 text-muted-foreground">{label}</span>
                    <span className="min-w-0 truncate font-semibold text-foreground">{value}</span>
                  </span>
                ))}
              </div>
              <section>
                <SectionTitle
                  title={`Boxes · ${boxes.length}`}
                  aside={
                    canEdit && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => setBoxDialog((s) => ({ open: true, box: null, seq: s.seq + 1 }))}
                      >
                        <Plus size={14} /> Add a box
                      </Button>
                    )
                  }
                />
                {boxCards}
              </section>
            </div>

            <aside className="min-w-0 xl:sticky xl:top-2 xl:self-start">
              <div className="overflow-hidden rounded-2xl border border-border bg-card">
                <div className="space-y-3 p-4">
                  <h2 className="text-label font-bold uppercase tracking-wider text-muted-foreground">Your move</h2>
                  <p className="text-[15px] font-bold leading-snug text-foreground">{status}</p>
                  {moves.length > 0 && (
                    <ul className="space-y-3">
                      {moves.map((move) => (
                        <MoveButton key={move.key} move={move} origin="card" disabled={packing} busy={packing} failure={failure} onRun={run} />
                      ))}
                    </ul>
                  )}
                </div>
                <ol className="border-t border-border p-1.5">
                  <li className="flex items-center gap-3 rounded-xl bg-muted px-3 py-2">
                    <StepMark state={gates[0].state} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-bold text-foreground">Packed by</span>
                      <span className="block truncate text-[12px] text-muted-foreground">{gates[0].line}</span>
                    </span>
                    <StateWord state={gates[0].state} className="shrink-0 text-xs" />
                  </li>
                </ol>
              </div>
            </aside>
          </div>
          {dialog}

          {canEdit && (
            <BoxDialog
              key={boxDialog.seq}
              open={boxDialog.open}
              onOpenChange={(open) => setBoxDialog((s) => ({ ...s, open }))}
              box={boxDialog.box}
              listId={id}
              onSaved={refresh}
            />
          )}
          {canEdit && contentsBox && (
            <ContentsDialog
              open={Boolean(contentsBox)}
              onOpenChange={(open) => !open && setContentsBox(null)}
              box={contentsBox}
              sorId={list.sorId}
              onSaved={refresh}
            />
          )}
        </>
      )}
    </ModalShell>
  );
}

export default function PackingListPageRoute() {
  const navigate = useNavigate();
  // The record is a modal over its list; the URL keeps working as a deep link.
  return (
    <>
      <PackingListsPage />
      <ProtectedRoute>
        <PackingListPage onClose={() => navigate(LIST_PATH)} />
      </ProtectedRoute>
    </>
  );
}
