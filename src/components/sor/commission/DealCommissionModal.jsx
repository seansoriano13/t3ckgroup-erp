import { useNavigate } from "react-router";
import { ArrowUpRight } from "lucide-react";
import { Button } from "../../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../ui/dialog";
import Avatar from "../../Avatar";
import StatusBadge from "../../StatusBadge";
import { formatPHP } from "../../../constants/sor";
import { MASK, TONE, compactPHP, formatContractDate, projectTypeInfo, shareRoleLabel } from "./commissionView";
import { Swatch, SplitBar } from "./parts";

function Figure({ label, value, tone }) {
  return (
    <div className="min-w-0 px-4 py-3.5">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">{tone && <Swatch tone={tone} />}{label}</p>
      <p className="mt-1 truncate text-lg font-semibold tabular-nums tracking-tight text-foreground">{value}</p>
    </div>
  );
}

/** One receipt line: operator | label | amount, on a fixed grid so every column lines up. */
function Step({ op, label, value, kind }) {
  const total = kind === "total";
  const subtotal = kind === "subtotal";
  return (
    <div className={`grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-sm ${total ? "rounded-lg bg-blue-3 text-blue-12" : subtotal ? "border-t border-border" : ""}`}>
      <span className={`text-center ${total ? "text-blue-11" : "text-muted-foreground"}`}>{op}</span>
      <span className={total || subtotal ? "font-medium" : "text-muted-foreground"}>{label}</span>
      <span className={`tabular-nums ${total ? "font-semibold" : subtotal ? "font-medium text-foreground" : "text-foreground"}`}>{value}</span>
    </div>
  );
}

/**
 * One SOR's commission receipt: how its pool is worked out from the rates its
 * Contract Date anchored, and who the Sales fund goes to. Amounts follow
 * Privacy Masking.
 */
export default function DealCommissionModal({ deal, onClose, access }) {
  const navigate = useNavigate();
  const { user, canViewAllFinancials, canViewSalesAmounts, salesPercent } = access;
  const seeDeal = deal && (canViewSalesAmounts || deal.participants?.dealOwner?.id === user?.id);

  const vat = deal?.rates?.vatPercent;
  const withholding = deal?.rates?.withholdingPercent;
  const pool = deal?.rates?.poolPercent;
  const contract = deal?.contractValue || 0;
  const exVat = vat != null ? contract / (1 + vat / 100) : contract;
  const money = (n) => (canViewAllFinancials ? formatPHP(n) : MASK);
  const shares = deal?.salesRoleShares || [];
  const fund = deal?.salesShareAmount || 0;
  const meta = deal ? [deal.opportunityNo, projectTypeInfo(deal.projectType)?.long ?? deal.projectType, deal.projectTitle].filter(Boolean) : [];

  const barParts = [
    ...shares.map((s, i) => ({ key: `${s.role}${i}`, percent: fund ? (s.amount / fund) * 100 : 0, color: TONE[s.role]?.solid })),
    ...(deal?.unattributedSalesAmount > 0 ? [{ key: "unattributed", percent: (deal.unattributedSalesAmount / fund) * 100, color: "var(--mauve-6)" }] : []),
  ];

  return (
    <Dialog open={!!deal} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        {deal && (
          <>
            <DialogHeader className="gap-1 px-6 pb-4 pt-6 pr-12">
              <div className="mb-1"><StatusBadge status={deal.status} /></div>
              <DialogTitle className="text-lg font-semibold tracking-tight">{deal.clientName}</DialogTitle>
              <DialogDescription className="truncate text-xs">{meta.join(" · ")}</DialogDescription>
            </DialogHeader>

            <div className="max-h-[62vh] space-y-6 overflow-y-auto px-6 pb-6">
              <div className="grid grid-cols-3 divide-x divide-border rounded-xl border border-border">
                <Figure label="Contract" value={compactPHP(contract)} />
                <Figure label="Pool" tone="pool" value={canViewAllFinancials ? compactPHP(deal.commissionPool) : MASK} />
                <Figure label="Sales fund" tone="sales" value={seeDeal ? compactPHP(fund) : MASK} />
              </div>

              <section>
                <h4 className="mb-2 text-sm font-semibold text-foreground">How the pool is worked out</h4>
                <Step op="" label="Contract value" value={formatPHP(contract)} />
                <Step op="−" label={`VAT ${vat ?? "—"}%`} value={money(contract - exVat)} />
                <Step op="−" label={`Withholding ${withholding ?? "—"}%`} value={money(exVat - (deal.commissionableRevenue || 0))} />
                <Step op="=" label="Commissionable Revenue" value={money(deal.commissionableRevenue)} kind="subtotal" />
                <Step op="×" label="Pool rate" value={`${pool ?? "—"}%`} />
                <Step op="=" label="Commission Pool" value={money(deal.commissionPool)} kind="total" />
              </section>

              <section>
                <div className="mb-3 flex items-baseline justify-between">
                  <h4 className="text-sm font-semibold text-foreground">Who gets the Sales fund</h4>
                  <span className="text-xs text-muted-foreground">{salesPercent}% of the pool</span>
                </div>
                <SplitBar parts={barParts} className="h-2" />
                <ul className="mt-3 divide-y divide-border">
                  {shares.map((s, i) => (
                    <li key={`${s.role}${i}`} className="flex items-center justify-between gap-4 py-2.5">
                      <span className="flex min-w-0 items-center gap-3">
                        {s.employee ? (
                          <Avatar name={s.employee.name} src={s.employee.avatar_path || s.employee.avatarPath} size="md" />
                        ) : (
                          <span className="h-8 w-8 shrink-0 rounded-xl border border-dashed border-border" aria-hidden />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-foreground">{s.employee?.name ?? "Unassigned"}</span>
                          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Swatch tone={s.role} />
                            {shareRoleLabel(s.role)}
                            {s.percent != null && ` · ${s.percent}%`}
                          </span>
                        </span>
                      </span>
                      <span className="shrink-0 text-sm font-medium tabular-nums text-foreground">
                        {seeDeal || s.employee?.id === user?.id ? formatPHP(s.amount) : MASK}
                      </span>
                    </li>
                  ))}
                </ul>
                {deal.unattributedSalesAmount > 0 && (
                  <p className="mt-2 rounded-lg bg-amber-3 px-3 py-2 text-xs text-amber-11">
                    {seeDeal ? formatPHP(deal.unattributedSalesAmount) : MASK} isn&apos;t going to anyone yet — a role on this SOR has no one assigned.
                  </p>
                )}
              </section>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/40 px-6 py-3.5">
              <span className="text-xs text-muted-foreground">
                {deal.contractDate ? `Rates as of ${formatContractDate(deal.contractDate)}` : "Live rates · no Contract Date yet"}
              </span>
              <Button type="button" variant="outline" size="sm" onClick={() => navigate("/sors", { state: { openOpportunityId: deal.id } })}>
                Open SOR <ArrowUpRight />
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
