import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { CircleAlert, CloudOff, SearchCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldBox } from "@/components/ui/FieldBox";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/SelectField";
import { Textarea } from "@/components/ui/textarea";
import Spinner from "@/components/ui/Spinner";
import StatusBadge from "../StatusBadge";
import SorPicker from "./SorPicker";
import { ipasService } from "../../services/ipasService";
import {
  IPAS_ERROR,
  IPAS_PRIORITIES,
  IPAS_PRIORITY_LABELS,
  IPAS_PURPOSE,
  IPAS_PURPOSES,
  IPAS_PURPOSE_LABELS,
  IPAS_SOURCES,
  IPAS_SOURCE_LABELS,
  ODOO_PO_STATE_LABELS,
} from "../../constants/ipas";
import { PO_NUMBER_HINT, isValidPoNumber, normalizePoNumber } from "../../constants/procurement";
import { ipasErrorMessage } from "../../utils/ipas";
import { ipasListKey } from "./ipasKeys";

const options = (values, labels) => values.map((value) => ({ value, label: labels[value] }));
const PRIORITY_OPTIONS = options(IPAS_PRIORITIES, IPAS_PRIORITY_LABELS);
const SOURCE_OPTIONS = options(IPAS_SOURCES, IPAS_SOURCE_LABELS);
const PURPOSE_OPTIONS = options(IPAS_PURPOSES, IPAS_PURPOSE_LABELS);

const BLANK = { priority: "", source: "", purpose: "", remarks: "" };

/**
 * Raising an IPAS (#242). First the PO: its number is checked against Odoo,
 * which says whether it has the PO, or couldn't be asked (those read
 * differently on purpose). Then the header: Priority, Source, Purpose, and
 * for a Project the SORs, suggested from what the PO mentions.
 * `onCreated(ipas)` gets the new row.
 */
export default function NewIpasDialog({ open, onOpenChange, onCreated }) {
  const queryClient = useQueryClient();
  const [poNumber, setPoNumber] = useState("");
  const [checked, setChecked] = useState(null); // { po, copy, suggestions, live }
  const [problem, setProblem] = useState(null); // { code, message }
  const [form, setForm] = useState(BLANK);
  const [sors, setSors] = useState([]);

  const reset = () => {
    setPoNumber("");
    setChecked(null);
    setProblem(null);
    setForm(BLANK);
    setSors([]);
  };
  const close = () => {
    reset();
    onOpenChange(false);
  };

  const checkMutation = useMutation({
    mutationFn: async () => {
      const po = normalizePoNumber(poNumber);
      if (!isValidPoNumber(po)) {
        const error = new Error(PO_NUMBER_HINT);
        error.code = IPAS_ERROR.PO_INVALID;
        throw error;
      }
      const [copy, live] = await Promise.all([ipasService.readPurchaseOrder(po), ipasService.findLive(po)]);
      const suggestions = await ipasService.suggestSors(copy).catch(() => []);
      return { po, copy, suggestions, live };
    },
    onMutate: () => setProblem(null),
    onSuccess: (result) => {
      setChecked(result);
      // A Project names its SORs: start from what the PO mentions.
      setSors(result.suggestions);
    },
    onError: (error) => setProblem({ code: error.code, message: error.message }),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      ipasService.create({
        poNumber: checked.po,
        priority: form.priority,
        source: form.source,
        purpose: form.purpose,
        sorIds: form.purpose === IPAS_PURPOSE.PROJECT ? sors.map((s) => s.id) : [],
        remarks: form.remarks.trim(),
      }),
    onSuccess: (row) => {
      toast.success(`${row.number} raised.`);
      queryClient.invalidateQueries({ queryKey: ipasListKey });
      close();
      onCreated?.(row);
    },
    onError: (error) => {
      if (error?.code === IPAS_ERROR.PO_NOT_FOUND || error?.code === IPAS_ERROR.ODOO_UNAVAILABLE) {
        setChecked(null);
        setProblem({ code: error.code, message: error.message });
      } else {
        toast.error(ipasErrorMessage(error));
      }
    },
  });

  const isProject = form.purpose === IPAS_PURPOSE.PROJECT;
  const ready =
    !!checked &&
    !checked.live &&
    form.priority !== "" &&
    form.source !== "" &&
    form.purpose !== "" &&
    (!isProject || sors.length > 0);
  const busy = checkMutation.isPending || createMutation.isPending;
  const set = (field) => (value) => setForm((prev) => ({ ...prev, [field]: value }));

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="shrink-0 pr-10">
          <DialogTitle>Raise an IPAS</DialogTitle>
          <DialogDescription>
            Start from the Odoo purchase order. Its supplier, currency and item lines come from Odoo.
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 max-h-[62vh] space-y-4 overflow-y-auto px-1">
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy && poNumber.trim()) checkMutation.mutate();
            }}
          >
            <FieldBox label="Odoo PO number" bare className="flex-1">
              <Input
                value={poNumber}
                disabled={busy || !!checked}
                onChange={(e) => setPoNumber(e.target.value)}
                placeholder="e.g. P02552"
                autoComplete="off"
              />
            </FieldBox>
            {checked ? (
              <Button type="button" variant="outline" disabled={busy} onClick={reset}>
                Change PO
              </Button>
            ) : (
              <Button type="submit" variant="outline" disabled={busy || !poNumber.trim()}>
                {checkMutation.isPending ? <Spinner size="sm" /> : <SearchCheck size={14} />}
                Check in Odoo
              </Button>
            )}
          </form>

          {problem && <PoProblem problem={problem} />}

          {checked && <PoSummary copy={checked.copy} live={checked.live} />}

          {checked && !checked.live && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <FieldBox label="Priority" bare>
                  <SelectField
                    options={PRIORITY_OPTIONS}
                    value={form.priority}
                    onChange={set("priority")}
                    placeholder="Pick"
                  />
                </FieldBox>
                <FieldBox label="Source" bare>
                  <SelectField options={SOURCE_OPTIONS} value={form.source} onChange={set("source")} placeholder="Pick" />
                </FieldBox>
                <FieldBox label="Purpose" bare>
                  <SelectField
                    options={PURPOSE_OPTIONS}
                    value={form.purpose}
                    onChange={set("purpose")}
                    placeholder="Pick"
                  />
                </FieldBox>
              </div>

              {isProject && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold">SORs</p>
                  <SorPicker selected={sors} onChange={setSors} suggestions={checked.suggestions} />
                </div>
              )}

              <FieldBox label="Remarks" bare>
                <Textarea
                  value={form.remarks}
                  onChange={(e) => set("remarks")(e.target.value)}
                  rows={2}
                  placeholder={isProject ? "Anything Finance should know" : 'e.g. "Stock" or "Wosas Event 2026"'}
                />
              </FieldBox>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" size="lg" onClick={close}>
            Cancel
          </Button>
          <Button size="lg" disabled={!ready || busy} onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? "Raising…" : "Raise IPAS"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const PROBLEM_HEADING = {
  [IPAS_ERROR.ODOO_UNAVAILABLE]: "Odoo couldn't be checked",
  [IPAS_ERROR.PO_NOT_FOUND]: "Not found in Odoo",
  [IPAS_ERROR.PO_INVALID]: "Not an Odoo PO number",
};

/** "Odoo has no such PO" and "Odoo couldn't be asked" look different on purpose. */
function PoProblem({ problem }) {
  const couldNotCheck = problem.code === IPAS_ERROR.ODOO_UNAVAILABLE;
  const Icon = couldNotCheck ? CloudOff : CircleAlert;
  return (
    <div
      role="alert"
      className={`flex gap-2.5 rounded-lg border p-3 text-[13px] ${
        couldNotCheck ? "border-amber-400 bg-amber-3/40 text-amber-11" : "border-red-400 bg-red-3/40 text-red-11"
      }`}
    >
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div>
        <p className="font-semibold">{PROBLEM_HEADING[problem.code] || "Something went wrong"}</p>
        <p>{ipasErrorMessage({ message: problem.message })}</p>
      </div>
    </div>
  );
}

function PoSummary({ copy, live }) {
  const { po, supplier, lines } = copy;
  return (
    <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-semibold">{po.name}</span>
        <StatusBadge theme="blue" label={ODOO_PO_STATE_LABELS[po.state] || po.state} />
        <span className="text-muted-foreground">{po.company}</span>
      </div>
      <p>
        <span className="font-medium">{supplier?.name || "No supplier"}</span>
        <span className="text-muted-foreground">
          {" "}
          · {po.currency} · {lines.length} {lines.length === 1 ? "item" : "items"}
        </span>
      </p>
      {live && (
        <p role="alert" className="font-medium text-red-11">
          {po.name} already has a live IPAS ({live.number}). Cancel it to raise a new one.
        </p>
      )}
    </div>
  );
}
