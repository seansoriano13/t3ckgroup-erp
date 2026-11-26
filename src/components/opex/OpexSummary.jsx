import { Cell } from "@/components/costing/GridCell";
import { formatPesos } from "@/utils/opexReport";

/** The amber "typed" mark: the same look as the S0 Evaluation's "estimate". */
export function TypedMark({ title = "Typed by Finance, not from Odoo" }) {
  return (
    <span className="ml-1.5 rounded bg-amber-a3 px-1.5 py-0.5 text-xs font-normal text-amber-12" title={title}>
      typed
    </span>
  );
}

const rateLabel = (rate) => `${Number((Number(rate) * 100).toFixed(4))}%`;
const percent = (v) => (v === null || v === undefined ? "—" : `${Number(v).toFixed(2)}%`);

function Waiting() {
  return <span className="inline-block h-3.5 w-20 animate-pulse rounded bg-muted align-middle" aria-label="Reading Odoo" />;
}

function Row({ label, hint, children, strong = false }) {
  return (
    <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 py-1.5 ${strong ? "border-t border-border/70 pt-2.5" : ""}`}>
      <dt className={`min-w-0 text-sm ${strong ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
        {label}
        {hint && <span className="block text-xs font-normal text-muted-foreground/80">{hint}</span>}
      </dt>
      <dd className={`text-right text-sm tabular-nums ${strong ? "font-semibold text-foreground" : "text-foreground"}`}>{children}</dd>
    </div>
  );
}

/**
 * The OPEX Report's summary, laid out like the S0 Evaluation's: one row per figure, what it is
 * worked from under its name, Revenue closing it. Contract price and Retention are typed in
 * their boxes, the way Marketing is on the S0 Evaluation; clearing a box goes back to Odoo's
 * price or the retention rate. Before Odoo is read, the saved figures show and the rest wait.
 */
export default function OpexSummary({ quick, report, read, settings, onField }) {
  if (!quick) return null;
  const waiting = quick.fromSnapshot;
  const figure = (v) => (waiting && v === undefined ? <Waiting /> : v === null || v === undefined ? "—" : formatPesos(v));
  const contractTyped = report?.contract_price != null;
  const retentionTyped = report?.retention != null;
  const odooPrice = read?.odooContractPrice ?? null;
  const goLine = Number(settings?.goLinePercent ?? 20);
  const under = quick.revenuePercent !== null && quick.revenuePercent !== undefined && quick.revenuePercent < goLine;

  return (
    <dl className="divide-y divide-border/40">
      <Row
        label={<>Contract price{contractTyped && <TypedMark />}</>}
        hint={
          contractTyped
            ? odooPrice !== null
              ? `Odoo's S0 says ${formatPesos(odooPrice)}. Clear the box to use it.`
              : "Clear the box to use Odoo's price."
            : "Odoo's S0 price, VAT in. Type over it if the contract differs."
        }
      >
        <Cell
          className="ml-auto w-40"
          label="Contract price"
          noun="Contract price"
          value={quick.contractPrice}
          numeric
          money
          align="right"
          readOnly={waiting}
          onSave={(v) => onField("contract_price", v)}
        />
      </Row>
      <Row label="VAT-exclusive" hint={settings ? `Contract price ÷ ${Number(settings.vatDivisor)}` : null}>
        {figure(quick.vatExclusive)}
      </Row>
      <Row label={`Less Tax${settings ? ` ${rateLabel(settings.taxRate)}` : ""}`} hint="on the VAT-exclusive figure">
        {figure(quick.tax)}
      </Row>
      <Row
        label={
          <>
            Retention{!retentionTyped && settings ? ` ${rateLabel(settings.retentionRate)}` : ""}
            {retentionTyped && <TypedMark />}
          </>
        }
        hint={retentionTyped ? "What the client really kept. Clear the box to use the rate." : "Worked at the rate. Type what the client really kept."}
      >
        {waiting ? (
          <Waiting />
        ) : (
          <Cell
            className="ml-auto w-40"
            label="Retention"
            noun="Retention"
            value={retentionTyped ? Number(report.retention) : quick.retention}
            numeric
            money
            align="right"
            onSave={(v) => onField("retention", v)}
          />
        )}
      </Row>
      <Row label="Collected Amount">{figure(quick.collected)}</Row>
      <Row label="Product cost" hint="the counted P0 lines, plus Typed costs">
        {figure(quick.productCost)}
      </Row>
      <Row label="Operation & Admin" hint="expenses, plus Typed costs">
        {figure(quick.operationAdmin)}
      </Row>
      <Row label="Marketing" hint="expenses, plus Typed costs">
        {figure(quick.marketing)}
      </Row>
      <Row label="Actual OPEX" hint="retention + product cost + operation & admin + marketing">
        {figure(quick.actualOpex)}
      </Row>
      <Row label={`ITR${settings ? ` ${rateLabel(settings.itrRate)}` : ""}`} hint={settings ? `of the contract price above ${formatPesos(Number(settings.itrAllowance))}` : null}>
        {figure(quick.itr)}
      </Row>
      <Row label="Revenue" strong>
        {figure(quick.revenue)}
      </Row>
      <Row label="Revenue ÷ Contract price" hint={`the go line is ${goLine}%`}>
        <span className={under ? "font-semibold text-amber-11" : undefined}>{percent(quick.revenuePercent)}</span>
      </Row>
    </dl>
  );
}
