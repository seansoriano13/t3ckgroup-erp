import { useState } from "react";
import { CircleAlert, CloudOff, Link2, SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import ModalShell from "@/components/ui/ModalShell";
import { FieldBox } from "@/components/ui/FieldBox";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/SelectField";
import Spinner from "@/components/ui/Spinner";
import SorPicker from "../ipas/SorPicker";
import { RequiredMark } from "../ipas/record/FormFields";
import { useEmployeeOptions } from "./useEmployeeOptions";
import { costingMatrixService, StandaloneStartError } from "../../services/costingMatrixService";
import { STANDALONE_START_PROBLEM } from "../../constants/costing";
import { isS0Number } from "../../utils/standaloneEvaluation";
import { useAuth } from "../../context/AuthContext";
import InchargeSelects from "./InchargeSelects";

const PROBLEM_ICON = {
  [STANDALONE_START_PROBLEM.NOT_S0]: CircleAlert,
  [STANDALONE_START_PROBLEM.NOT_FOUND]: SearchX,
  [STANDALONE_START_PROBLEM.ODOO_DOWN]: CloudOff,
};

/**
 * "New evaluation from an S0" (#966): the S0 number, the Sales incharge and the PMS incharge. The lines and quantities
 * are pulled from the sale order in Odoo. The three ways it can fail are said apart: not an S0 number, no such S0 in
 * Odoo, Odoo unreachable. An S0 that already has an evaluation opens that one instead. `onOpen(subjectId)` is called
 * with what the window opens by.
 */
export function NewStandaloneDialog({ open, onOpenChange, onOpen }) {
  const { user } = useAuth();
  const options = useEmployeeOptions();
  const [s0Number, setS0Number] = useState("");
  const [sales, setSales] = useState(user?.id ?? "");
  const [pms, setPms] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  const ready = isS0Number(s0Number) && sales !== "" && pms !== "";
  const close = () => {
    setProblem(null);
    onOpenChange(false);
  };

  const start = async (event) => {
    event?.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await costingMatrixService.startStandalone({ s0Number, salesIncharge: sales, pmsIncharge: pms });
      setBusy(false);
      onOpenChange(false);
      onOpen(result.subjectId);
    } catch (error) {
      setBusy(false);
      setProblem({ kind: error instanceof StandaloneStartError ? error.kind : STANDALONE_START_PROBLEM.OTHER, message: error.message });
    }
  };

  const Icon = PROBLEM_ICON[problem?.kind] ?? CircleAlert;

  return (
    <ModalShell
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      crumbs={["S0 Evaluation", "New evaluation from an S0"]}
      onSubmit={start}
      actions={
        <Button type="submit" disabled={!ready || busy} data-testid="standalone-start">
          {busy ? "Reading Odoo…" : "Start evaluation"}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        Start from the S0 alone, with no SOR. The lines and quantities come from the sale order in Odoo. If the S0 already has an evaluation, that one opens instead.
      </p>
      <div className="space-y-4">
        <FieldBox label={<>S0 number <RequiredMark /></>} bare>
          <Input
            value={s0Number}
            disabled={busy}
            onChange={(e) => setS0Number(e.target.value)}
            placeholder="e.g. S01237"
            autoComplete="off"
            aria-label="S0 number"
          />
        </FieldBox>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FieldBox label={<>Sales incharge <RequiredMark /></>} bare>
            <SelectField options={options} value={sales} onChange={setSales} placeholder="Pick" aria-label="Sales incharge" />
          </FieldBox>
          <FieldBox label={<>PMS incharge <RequiredMark /></>} bare>
            <SelectField options={options} value={pms} onChange={setPms} placeholder="Pick" aria-label="PMS incharge" />
          </FieldBox>
        </div>
        {busy && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner size="sm" /> Reading the sale order in Odoo…
          </p>
        )}
        {problem && (
          <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid={`standalone-problem-${problem.kind}`}>
            <Icon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
            {problem.message}
          </p>
        )}
      </div>
    </ModalShell>
  );
}

/**
 * "Link to a SOR" (#966): attaches the evaluation to a SOR that has none. From then on the SOR's rules decide who
 * reads it. A SOR that already has an evaluation, or is on another S0, is refused by the database in words.
 */
export function LinkToSorDialog({ open, onOpenChange, matrixId, s0Number, onLinked }) {
  const [sor, setSor] = useState([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  const close = () => {
    setProblem(null);
    setSor([]);
    onOpenChange(false);
  };
  const link = async () => {
    if (sor.length === 0 || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await costingMatrixService.linkStandaloneToSor(matrixId, sor[0].id);
      setBusy(false);
      onOpenChange(false);
      onLinked(result.opportunity_id);
    } catch (error) {
      setBusy(false);
      setProblem(error.message);
    }
  };

  return (
    <ModalShell
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      crumbs={["S0 Evaluation", `Link ${s0Number ?? "the evaluation"} to a SOR`]}
      actions={
        <Button type="button" disabled={sor.length === 0 || busy} onClick={link} data-testid="standalone-link">
          {busy ? "Linking…" : "Link to this SOR"}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">
        Pick the SOR this evaluation belongs to. It must be a SOR with no S0 Evaluation yet. From then on that SOR&apos;s rules decide who reads it, and the Sales and PMS incharge named here no longer give access.
      </p>
      <SorPicker selected={sor} onChange={(list) => setSor(list.slice(-1))} />
      {problem && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" data-testid="standalone-link-problem">
          <CircleAlert size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {problem}
        </p>
      )}
    </ModalShell>
  );
}

/**
 * The strip a standalone evaluation shows in place of the SOR's incharges (#966): the S0 it was started from with a "No SOR"
 * mark, the Sales incharge and the PMS incharge (anyone can be named; changeable by the starter, the Sales incharge and
 * the decider list), the Technical in-charge as on any evaluation, and "Link to a SOR".
 */
export function StandaloneBar({ matrix, technicalOptions, nameOf, canTechnical, onSaved, onLinked }) {
  const options = useEmployeeOptions();
  const [linking, setLinking] = useState(false);
  const tier = matrix.tier;
  const canName = tier === "closed_book" || tier === "price";
  const row = matrix.matrix ?? {};

  return (
    <div className="space-y-2" data-testid="standalone-bar">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-semibold text-muted-foreground">No SOR</span>
        <span className="text-muted-foreground">
          Started from {row.s0_number ?? "an S0"}
          {row.created_by && nameOf(row.created_by) ? ` by ${nameOf(row.created_by)}` : ""}.
        </span>
        {canName && (
          <Button type="button" variant="outline" size="xs" onClick={() => setLinking(true)} data-testid="standalone-link-open">
            <Link2 size={12} aria-hidden="true" />
            Link to a SOR
          </Button>
        )}
      </div>
      <InchargeSelects
        sales={row.sales_incharge_id}
        purchasing={row.purchasing_incharge_id}
        salesOptions={options}
        purchasingOptions={options}
        canSales={canName}
        canPurchasing={canName}
        purchasingLabel="PMS incharge"
        technical={row.technical_incharge_id}
        technicalOptions={technicalOptions}
        canTechnical={canTechnical}
        onSave={async (who) => {
          if ("technical" in who) return onSaved({ technical: who.technical });
          // The database takes the two names together; the one not being changed stays.
          return onSaved({
            sales: "sales" in who ? who.sales : row.sales_incharge_id,
            pms: "purchasing" in who ? who.purchasing : row.purchasing_incharge_id,
          });
        }}
      />
      <LinkToSorDialog open={linking} onOpenChange={setLinking} matrixId={matrix.matrixId} s0Number={row.s0_number} onLinked={onLinked} />
    </div>
  );
}
