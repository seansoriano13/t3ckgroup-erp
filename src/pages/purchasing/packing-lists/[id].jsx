import { useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ArrowLeft, Check, Pencil, Plus, Printer, Trash2 } from "lucide-react";
import { openPackingListPrintWindow, printPackingList } from "../../../lib/pdf/packingListPrinter";

import ProtectedRoute from "../../../components/ProtectedRoute";
import { Button } from "../../../components/ui/button";
import PageShell from "../../../components/ui/PageShell";
import PageLoading from "../../../components/ui/PageLoading";
import EmptyState from "../../../components/ui/EmptyState";
import QueryError from "../../../components/ui/QueryError";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import { FieldBox } from "../../../components/ui/FieldBox";
import { Input } from "../../../components/ui/input";
import { SelectField } from "../../../components/ui/SelectField";
import NumbersStrip from "../../../components/record/NumbersStrip";
import RecordCard from "../../../components/record/RecordCard";
import RecordDrawer from "../../../components/record/RecordDrawer";
import RecordRows from "../../../components/record/RecordRows";
import { STATE } from "../../../components/record/statePalette";
import { useOpenSection } from "../../../components/record/useOpenSection";
import { useAuth } from "../../../context/AuthContext";
import { getPermissionContext } from "../../../utils/permissions";
import { packingListService, sorLineSnapshot } from "../../../services/packingListService";
import { ipasErrorMessage } from "../../../utils/ipas";

/**
 * One Packing List (#255, spec #251), laid out like the IPAS record page (#538):
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{box ? `Box ${box.boxNo}` : "Add a box"}</DialogTitle>
          <DialogDescription>Marks, seal number and gross weight, where known.</DialogDescription>
        </DialogHeader>
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
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save box"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Box {box?.boxNo} contents</DialogTitle>
          <DialogDescription>Type each content, or pick it from the SOR's Product List (copied as it is now).</DialogDescription>
        </DialogHeader>
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
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save contents"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SECTION = { DETAILS: "details", BOXES: "boxes", PACKED_BY: "packed_by" };
const SECTIONS = [
  { key: SECTION.DETAILS, title: "Details" },
  { key: SECTION.BOXES, title: "Boxes" },
  { key: SECTION.PACKED_BY, title: "Packed by" },
];

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const formatWhen = (value) => (value ? new Date(value).toLocaleString() : "");

function PackingListPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { hasPurchasingFlow, isSuperAdmin } = getPermissionContext(user);

  // `seq` remounts the box dialog on every open, so a new box starts blank.
  const [boxDialog, setBoxDialog] = useState({ open: false, box: null, seq: 0 });
  const [contentsBox, setContentsBox] = useState(null);
  const [packing, setPacking] = useState(false);
  const [failure, setFailure] = useState(null);
  const rowEls = useRef({});
  const { index, current, open: openSection, step, close } = useOpenSection({ drawerSections: SECTIONS });

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
      run: (from) => (boxes.length === 0 ? openSection(SECTION.BOXES) : pack(from)),
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

  const summaries = list && {
    [SECTION.DETAILS]:
      [list.sorReference, list.projectTitle, list.odooDeliveryRef ? `Odoo ${list.odooDeliveryRef}` : null]
        .filter(Boolean)
        .join(" · ") || "No SOR",
    [SECTION.BOXES]:
      boxes.length === 0
        ? "No boxes yet"
        : `${plural(boxes.length, "box", "boxes")} · ${totalWeight.toFixed(2)} kg${weighed < boxes.length ? ` (${weighed} of ${boxes.length} weighed)` : ""}`,
    [SECTION.PACKED_BY]: gates[0].line,
  };
  const stateOf = (key) => {
    if (key !== SECTION.PACKED_BY) return null;
    return { state: gates[0].state, detail: packed ? "Signed" : "Not yet" };
  };

  const bodyOf = (key) => {
    if (key === SECTION.DETAILS) {
      return (
        <div className="grid grid-cols-1 gap-4 text-[13px] sm:grid-cols-2">
          <div>
            <div className="text-muted-foreground">SOR</div>
            <div>{[list.sorReference, list.projectTitle].filter(Boolean).join(" · ") || "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Odoo delivery ref</div>
            <div>{list.odooDeliveryRef ?? "—"}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Made by</div>
            <div>{list.creatorName ?? "—"}</div>
          </div>
        </div>
      );
    }
    if (key === SECTION.PACKED_BY) {
      return (
        <p className="text-[13px]">
          {packed
            ? `${list.packerName ?? "Someone"}${list.packedAt ? ` · ${formatWhen(list.packedAt)}` : ""}`
            : "Not yet."}
        </p>
      );
    }
    return (
      <div className="space-y-4">
        {boxes.length === 0 && <EmptyState title="No boxes yet" description="Add a box, then list what is in it." />}
        {boxes.map((box) => (
          <div key={box.id} className="rounded-xl border border-border bg-card">
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
        {canEdit && (
          <Button variant="outline" className="gap-1.5" onClick={() => setBoxDialog((s) => ({ open: true, box: null, seq: s.seq + 1 }))}>
            <Plus size={14} />
            Add a box
          </Button>
        )}
      </div>
    );
  };

  const restate = () => (list ? `Signs Packed by on ${list.number}. The boxes and their contents can't be changed after.` : "");

  return (
    <PageShell
      title={list ? list.number : "Packing List"}
      description={list ? `${list.sorReference ?? ""}${list.projectTitle ? ` · ${list.projectTitle}` : ""}` : undefined}
      action={
        <div className="flex items-center gap-2">
          {list && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={printList}>
              <Printer size={14} />
              Print
            </Button>
          )}
          <Button variant="outline" size="sm" asChild className="gap-1.5">
            <Link to="/purchasing/packing-lists">
              <ArrowLeft size={14} />
              Packing Lists
            </Link>
          </Button>
        </div>
      }
    >
      {isLoading && <PageLoading label="Packing List" />}
      {isError && <QueryError title="This Packing List could not be loaded." onRetry={refetch} />}
      {!isLoading && !isError && !list && (
        <EmptyState title="Not found" description="This Packing List doesn't exist, or you can't read it." />
      )}

      {list && (
        <>
          <div className="grid gap-x-10 gap-y-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="min-w-0 space-y-8">
              <NumbersStrip
                stats={[
                  { key: "boxes", label: "Boxes", value: boxes.length, onOpen: () => openSection(SECTION.BOXES) },
                  {
                    key: "weight",
                    label: "Total weight",
                    value: weighed > 0 ? `${totalWeight.toFixed(2)} kg` : "—",
                    sub: weighed > 0 && weighed < boxes.length ? `${weighed} of ${boxes.length} weighed` : undefined,
                  },
                ]}
              />
              <RecordRows
                groups={[{ sections: SECTIONS }]}
                stateOf={stateOf}
                summaryOf={(key) => summaries[key]}
                onOpen={openSection}
                rowRef={(key) => (node) => {
                  rowEls.current[key] = node;
                }}
              />
            </div>
            <aside className="min-w-0 xl:sticky xl:top-2 xl:self-start">
              <RecordCard
                status={status}
                groups={[{ items: moves }]}
                gates={gates}
                restate={restate}
                reviewText={() => "Review section"}
                onReview={openSection}
                viewer={user?.name}
                busy={packing}
                failure={failure}
              />
            </aside>
          </div>

          <RecordDrawer
            number={list.number}
            sections={SECTIONS}
            current={current}
            index={index}
            step={step}
            close={close}
            getRow={(key) => rowEls.current[key]}
            onEdit={() => {}}
            body={current ? bodyOf(current.key) : null}
            summary={current ? summaries[current.key] : ""}
            moves={current ? moves.filter((move) => move.section === current.key) : []}
            editable={false}
            restate={restate}
            viewer={user?.name}
            busy={packing}
            failure={failure}
          />

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
    </PageShell>
  );
}

export default function PackingListPageRoute() {
  return (
    <ProtectedRoute>
      <PackingListPage />
    </ProtectedRoute>
  );
}
