import { useState } from "react";
import { Divide, Equal, Minus, X as Times } from "lucide-react";
import { Input } from "../../ui/input";
import { SelectField } from "../../ui/SelectField";
import { formatPHP } from "../../../constants/sor";
import { MASK, TONE, formatContractDate, projectTypeInfo, shareRoleLabel, splitRows, walkFormula } from "./commissionView";
import { ProjectTypeSwitch, SplitBar, Swatch } from "./parts";

const OP_ICON = { "−": Minus, "÷": Divide, "×": Times, "=": Equal };

function Operation({ op, amount, label, hint, strong, tone }) {
  const Icon = OP_ICON[op];
  return (
    <li className="relative flex items-center gap-4 py-2.5">
      <span
        className={`relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${strong ? "bg-foreground text-background" : "border border-border bg-card text-muted-foreground"}`}
        aria-label={op}
      >
        {Icon && <Icon size={12} strokeWidth={2.5} />}
      </span>
      <span className={`w-36 shrink-0 text-sm tabular-nums text-foreground ${strong ? "font-semibold" : ""}`}>{amount}</span>
      <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
        {tone && <Swatch tone={tone} />}
        <span className={strong ? "font-medium text-foreground" : ""}>{label}</span>
        {hint && <span className="hidden text-xs xl:inline">· {hint}</span>}
      </span>
    </li>
  );
}

/**
 * Try the formula on any contract value, or load a real SOR. A typed value is
 * hypothetical, so its amounts always show; a loaded SOR's follow Privacy
 * Masking and use the rates its Contract Date anchored. Nothing is saved.
 */
export default function CommissionCalculator({ access, splits }) {
  const { dashboard, rates, salesPercent, user, canViewAllFinancials, canViewSalesAmounts } = access;
  const ledger = dashboard.dealLedger || [];
  const [raw, setRaw] = useState("1,000,000");
  const [projectType, setProjectType] = useState("CP");
  const [dealId, setDealId] = useState("");

  const deal = ledger.find((d) => d.id === dealId);
  const contractValue = Number(String(raw).replace(/[^\d.]/g, "")) || 0;
  const r = deal
    ? { vat: deal.rates?.vatPercent ?? rates.vat, withholding: deal.rates?.withholdingPercent ?? rates.withholding, pool: deal.rates?.poolPercent ?? rates.pool }
    : rates;
  const f = walkFormula({
    contractValue,
    vatPercent: r.vat,
    withholdingPercent: r.withholding,
    poolPercent: r.pool,
    salesPercent,
    splits: splitRows(splits[projectType], projectType),
  });

  const seeCompany = !deal || canViewAllFinancials;
  const seeSales = !deal || canViewSalesAmounts || deal.participants?.dealOwner?.id === user?.id;
  const amount = (n, see) => (see ? formatPHP(n) : MASK);
  const namesFor = (role) =>
    (deal?.salesRoleShares || []).filter((s) => s.role === role).map((s) => s.employee?.name).filter(Boolean).join(", ") || "Unassigned";

  const loadDeal = (id) => {
    setDealId(id);
    const d = ledger.find((x) => x.id === id);
    if (!d) return;
    setRaw(Math.round(d.contractValue || 0).toLocaleString("en-PH"));
    if (projectTypeInfo(d.projectType)) setProjectType(d.projectType);
  };

  return (
    <section>
      <div className="mb-3">
        <h3 className="text-base font-semibold text-foreground">Try it</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">Type any contract value, or load a real SOR. Nothing is saved.</p>
      </div>
      <div className="grid overflow-hidden rounded-xl border border-border bg-card lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-5 border-b border-border p-6 lg:border-b-0 lg:border-r">
          <div>
            <p id="commission-calculator-contract" className="text-sm font-medium text-muted-foreground">Contract value</p>
            <div className="mt-1.5 flex items-center rounded-xl border border-border bg-background px-4 focus-within:border-mauve-8 focus-within:ring-2 focus-within:ring-mauve-5">
              <span className="text-2xl font-semibold text-muted-foreground">₱</span>
              <Input
                aria-labelledby="commission-calculator-contract"
                inputMode="decimal"
                value={raw}
                onChange={(e) => {
                  setRaw(e.target.value);
                  setDealId("");
                }}
                onBlur={() => setRaw(contractValue ? contractValue.toLocaleString("en-PH") : "")}
                className="h-14 border-0 bg-transparent px-2 text-2xl font-semibold tabular-nums text-foreground outline-none focus-visible:border-transparent focus-visible:ring-0"
              />
              <span className="shrink-0 text-xs font-medium text-muted-foreground">VAT incl.</span>
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium text-muted-foreground">Project Type</p>
            <ProjectTypeSwitch
              value={projectType}
              onChange={(v) => {
                setProjectType(v);
                setDealId("");
              }}
            />
            <p className="mt-1.5 text-xs text-muted-foreground">{projectTypeInfo(projectType)?.blurb}</p>
          </div>
          <div>
            <p className="mb-1.5 text-sm font-medium text-muted-foreground">Or load a real SOR</p>
            <SelectField
              value={dealId}
              onChange={loadDeal}
              placeholder={ledger.length ? "Choose a SOR…" : "No SORs in this period"}
              options={ledger.map((d) => ({ value: d.id, label: `${d.opportunityNo ?? "—"} · ${d.clientName}` }))}
              className="w-full"
            />
            {deal && <p className="mt-1.5 text-xs text-muted-foreground">Using the rates in force on {formatContractDate(deal.contractDate) ?? "today"}.</p>}
          </div>
        </div>

        <div className="p-6">
          <ol className="relative">
            <span aria-hidden className="absolute bottom-3 left-[11px] top-3 w-px bg-border" />
            <Operation op="−" amount={amount(f.vatAmount, seeCompany)} label={`VAT ${r.vat}%`} hint="divided out" tone="tax" />
            <Operation op="−" amount={amount(f.withholdingAmount, seeCompany)} label={`Withholding ${r.withholding}%`} hint="of the VAT-free amount" tone="tax" />
            <Operation op="=" amount={amount(f.commissionable, seeCompany)} label="Commissionable Revenue" strong />
            <Operation op="×" amount={`${r.pool}%`} label="Pool rate" tone="pool" />
            <Operation op="=" amount={amount(f.pool, seeCompany)} label="Commission Pool" strong />
            <Operation op="×" amount={`${salesPercent}%`} label="Sales share" hint={`${100 - salesPercent}% to the other departments`} tone="sales" />
          </ol>
          <div className="mt-4 rounded-xl bg-muted/60 p-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium text-foreground">Sales fund</span>
              <span className="text-xl font-semibold tabular-nums tracking-tight text-foreground">{amount(f.sales, seeSales)}</span>
            </div>
            <SplitBar className="mt-3 h-2" parts={f.roles.map((x) => ({ key: x.role, percent: x.percent, color: TONE[x.role].solid }))} />
            <ul className="mt-3 space-y-2">
              {f.roles.map((x) => (
                <li key={x.role} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <Swatch tone={x.role} />
                    <span className="text-foreground">{shareRoleLabel(x.role)}</span>
                    <span className="text-muted-foreground">{x.percent}%</span>
                    {deal && <span className="truncate text-xs text-muted-foreground">· {namesFor(x.role)}</span>}
                  </span>
                  <span className="shrink-0 font-medium tabular-nums text-foreground">{amount(x.amount, seeSales)}</span>
                </li>
              ))}
              {f.roles.length === 0 && <li className="text-sm text-muted-foreground">No split is set for this Project Type.</li>}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
