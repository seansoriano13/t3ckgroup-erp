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
import { unitOptionsWith } from "../../../constants/procurement";
import MoveButton from "../../../components/record/MoveButton";
import RecordHeader from "../../../components/record/RecordHeader";
import PropertyPills from "../../../components/record/PropertyPills";
import LinerList from "../../../components/record/LinerList";
import YourMoveCard from "../../../components/record/YourMoveCard";
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
                <SelectField
                  options={unitOptionsWith(row.unit)}
                  value={row.unit}
                  placeholder="Pick a unit"
                  onChange={(value) => setRow(index, { unit: value })}
                />
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
    // Any change to the list makes an earlier refusal stale, so the banner goes away.
    setFailure(null);
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
  const status = !list
    ? ""
    : packed
      ? "Packed. Nothing left to do."
      : moves.length > 0
        ? "Waiting for you: Packed by"
        : "Nothing needs you right now. Purchasing (or whoever made the list) adds the boxes and signs Packed by.";

  const weightText = weighed > 0 ? `${totalWeight.toFixed(2)} kg${weighed < boxes.length ? ` (${weighed} of ${boxes.length} weighed)` : ""}` : "";
  const pills = list
    ? [
        { key: "sor", label: "SOR", value: list.sorReference },
        { key: "odoo", label: "Odoo delivery", value: list.odooDeliveryRef },
        { key: "by", label: "Made by", value: list.creatorName },
        { key: "boxes", label: "Boxes", value: boxes.length ? String(boxes.length) : "" },
        { key: "weight", label: "Weight", value: weightText },
      ]
    : [];

  const boxRows = boxes.map((box) => {
    const count = box.contents.length;
    return {
      key: box.id,
      main: `Box ${box.boxNo}${box.marks ? ` · ${box.marks}` : ""}`,
      sub: `Seal ${box.sealNo ?? "—"} · ${count} ${count === 1 ? "content" : "contents"}`,
      quantity: box.grossWeightKg == null ? "— kg" : `${box.grossWeightKg} kg`,
      children: (
        <div className="space-y-3">
          <LinerList
            label={`Contents of box ${box.boxNo}`}
            empty="No contents yet."
            rows={box.contents.map((c) => ({
              key: c.id,
              main: c.description,
              quantity: `${c.quantity}${c.unit ? ` ${c.unit}` : ""}`,
            }))}
          />
          {canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setBoxDialog((s) => ({ open: true, box, seq: s.seq + 1 }))}>
                <Pencil size={13} />
                Edit box
              </Button>
              <Button variant="outline" size="sm" onClick={() => setContentsBox(box)}>
                Contents
              </Button>
              <Button variant="ghost" size="sm" className="gap-1.5 text-destructive" onClick={() => removeBox(box)}>
                <Trash2 size={13} />
                Remove
              </Button>
            </div>
          )}
        </div>
      ),
    };
  });

  const packedLine = packed
    ? `Packed by ${list.packerName ?? "someone"}${list.packedAt ? ` · ${formatWhen(list.packedAt)}` : ""}`
    : "Waiting for the maker of the list or Purchasing";

  const restate = () => (list ? `Signs Packed by on ${list.number}. The boxes and their contents can't be changed after.` : "");

  const { run, dialog } = useMoveConfirm({ restate, viewer: user?.name, origin: CHROME.CARD });

  return (
    <ModalShell
      open
      onOpenChange={(next) => !next && onClose()}
      size="record"
      crumbs={["Packing List", list?.number].filter(Boolean)}
      headerActions={list && <RecordMoreMenu items={[{ key: "print", label: "Print", icon: Printer, onSelect: printList }]} />}
    >
      {isLoading && <PageLoading label="Packing List" />}
      {isError && <QueryError title="This Packing List could not be loaded." onRetry={refetch} />}
      {!isLoading && !isError && !list && (
        <EmptyState title="Not found" description="This Packing List doesn't exist, or you can't read it." />
      )}

      {list && (
        <>
          <div className="space-y-6 pb-2">
            <RecordHeader
              reference={list.number}
              name={list.projectTitle}
              badge={{ label: packed ? "Packed" : "Draft", theme: packed ? "green" : "mauve" }}
              line={[list.sorReference, list.creatorName && `made by ${list.creatorName}`].filter(Boolean).join(" · ")}
            />
            <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_25rem]">
              <div className="min-w-0 space-y-6">
                <PropertyPills items={pills} />
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
                  <LinerList label="Boxes" rows={boxRows} empty="No boxes yet. Add a box, then list what is in it." />
                </section>
              </div>

              <aside className="min-w-0 xl:sticky xl:top-2 xl:self-start">
                <YourMoveCard
                  status={status}
                  steps={[
                    {
                      key: SECTION.PACKED_BY,
                      title: "Packed by",
                      summary: packedLine,
                      state: packed ? STATE.DONE : STATE.CURRENT,
                      needsMe: moves.length > 0,
                      body: packed ? null : <p className="text-[13px] text-muted-foreground">Signing closes the list. The boxes and their contents can't be changed after.</p>,
                      moves:
                        moves.length > 0 ? (
                          <ul className="space-y-3">
                            {moves.map((move) => (
                              <MoveButton key={move.key} move={move} origin="card" disabled={packing} busy={packing} failure={failure} onRun={run} />
                            ))}
                          </ul>
                        ) : null,
                    },
                  ]}
                />
              </aside>
            </div>
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
