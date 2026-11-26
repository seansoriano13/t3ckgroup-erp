// PROTOTYPE (throwaway): pieces the three OPEX options share. Not production code.
import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { CalendarClock, Plus, TrendingDown } from "lucide-react";

import FilterBar from "../../../../components/ui/FilterBar";
import { FilterSelect } from "../../../../components/ui/FilterDropdown";
import ModalShell from "../../../../components/ui/ModalShell";
import ConfirmDialog from "../../../../components/ui/ConfirmDialog";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { SelectField } from "../../../../components/ui/SelectField";
import { SortHead, Table, TableBody, TableCell, TableHeader, TableRow } from "../../../../components/ui/table";
import { TablePager } from "../../../../components/ui/TablePager";
import { IdentityCell } from "../../../../components/purchasing/list/IdentityCell";
import { StateCell } from "../../../../components/purchasing/list/StateCell";
import ExportButton from "../../../../components/purchasing/list/ExportButton";
import { Cell } from "../../../../components/costing/GridCell";
import { usePaging } from "../../../../hooks/usePaging";
import { useTableSort } from "../../../../hooks/useTableSort";
import { listAgeDays, listDate } from "../../../../utils/listDates";
import { COST_GROUPS, DEFAULT_COST_GROUP, normalizeS0, parseTyped } from "../../../../utils/opexReport";
import { HEALTH, peso, pct, sumOf } from "./data";

export const HEAD = "text-label font-bold uppercase tracking-wider";
const CHIP = "h-9 w-auto gap-2 px-2.5";
const CHIP_WRAPPER = "w-auto shrink-0";
const ALL = "__all__";

/** The amber "typed" mark, the same look as the S0 Evaluation's "estimate". */
export function TypedMark({ title = "Typed by Finance, not from Odoo" }) {
  return (
    <span className="ml-1.5 rounded bg-amber-a3 px-1.5 py-0.5 text-xs font-normal text-amber-12" title={title}>
      typed
    </span>
  );
}

export const rateLabel = (rate) => `${Number((Number(rate) * 100).toFixed(4))}%`;

function Pending() {
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
 * The summary, laid out like the S0 Evaluation's: one row per figure with what it is worked from
 * under its name, Revenue closing it. Contract price and Retention are typed in place, the way
 * Marketing is typed on the S0 Evaluation. No pencil buttons.
 */
export function SummaryList({ quick, edits, read, settings, actions, compact = false }) {
  if (!quick) return null;
  const s = quick;
  const wait = s.fromSnapshot;
  const f = (v) => (wait && v === undefined ? <Pending /> : v === null || v === undefined ? "—" : peso(v));
  const contractTyped = edits.contract_price != null;
  const retentionTyped = edits.retention != null;
  const odooPrice = read?.odooContractPrice ?? null;
  const goLine = Number(settings?.goLinePercent ?? 20);
  const under = s.revenuePercent !== null && s.revenuePercent !== undefined && s.revenuePercent < goLine;
  const hint = (text) => (compact ? null : text);

  return (
    <dl className="divide-y divide-border/40">
      <Row
        label={
          <>
            Contract price{contractTyped && <TypedMark />}
          </>
        }
        hint={
          contractTyped
            ? odooPrice !== null
              ? `Odoo's S0 says ${peso(odooPrice)}. Clear the box to use it.`
              : "Clear the box to use Odoo's."
            : hint("Odoo's S0 price, VAT in. Type over it if the contract differs.")
        }
      >
        <Cell
          className="ml-auto w-40"
          label="Contract price"
          noun="Contract price"
          value={s.contractPrice}
          numeric
          money
          align="right"
          readOnly={wait}
          onSave={async (v) => actions.setField("contract_price", v === s.contractPrice && !contractTyped ? null : v)}
        />
      </Row>
      <Row label="VAT-exclusive" hint={hint(settings ? `Contract price ÷ ${Number(settings.vatDivisor)}` : null)}>
        {f(s.vatExclusive)}
      </Row>
      <Row label={`Less Tax ${settings ? rateLabel(settings.taxRate) : ""}`} hint={hint("on the VAT-exclusive figure")}>
        {f(s.tax)}
      </Row>
      <Row
        label={
          <>
            Retention{!retentionTyped && settings ? ` ${rateLabel(settings.retentionRate)}` : ""}
            {retentionTyped && <TypedMark />}
          </>
        }
        hint={retentionTyped ? "What the client really kept. Clear the box to use the rate." : hint("Worked at the rate. Type what the client really kept.")}
      >
        {wait ? (
          <Pending />
        ) : (
          <Cell
            className="ml-auto w-40"
            label="Retention"
            noun="Retention"
            value={s.retention}
            numeric
            money
            align="right"
            onSave={async (v) => actions.setField("retention", v)}
          />
        )}
      </Row>
      <Row label="Collected Amount">{f(s.collected)}</Row>
      <Row label="Product cost" hint={hint("the counted P0 lines, plus Typed costs")}>
        {f(s.productCost)}
      </Row>
      <Row label="Operation & Admin" hint={hint("expenses, plus Typed costs")}>
        {f(s.operationAdmin)}
      </Row>
      <Row label="Marketing" hint={hint("expenses, plus Typed costs")}>
        {f(s.marketing)}
      </Row>
      <Row label="Actual OPEX" hint={hint("retention + product cost + operation & admin + marketing")}>
        {f(s.actualOpex)}
      </Row>
      <Row
        label={`ITR ${settings ? rateLabel(settings.itrRate) : ""}`}
        hint={hint(settings ? `of the contract price above ${peso(Number(settings.itrAllowance))}` : null)}
      >
        {f(s.itr)}
      </Row>
      <Row label="Revenue" strong>
        {f(s.revenue)}
      </Row>
      <Row label="Revenue ÷ Contract price" hint={hint(`the go line is ${goLine}%`)}>
        <span className={under ? "font-semibold text-amber-11" : undefined}>{pct(s.revenuePercent)}</span>
      </Row>
    </dl>
  );
}

/* ---------- Small dialogs (compact ModalShell, like Purchasing's raise steps) ---------- */

export function AddP0Dialog({ open, onOpenChange, onAdd }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = /^P\d+$/i.test(text.trim());
  const close = (next) => {
    if (!next) setText("");
    onOpenChange(next);
  };
  return (
    <ModalShell
      open={open}
      onOpenChange={close}
      crumbs={["OPEX", "Add a P0"]}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!ok) return;
        setBusy(true);
        const added = await onAdd(text);
        setBusy(false);
        if (added) close(false);
      }}
      actions={
        <Button type="submit" variant="primary" disabled={!ok || busy}>
          {busy ? "Checking Odoo…" : "Add P0"}
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">For a P0 that belongs to this S0 but has no Project tag and no Source Document naming it.</p>
      <Input label="P0 number" placeholder="e.g. P02367" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
    </ModalShell>
  );
}

const GROUP_OPTIONS = COST_GROUPS.map((g) => ({ value: g.key, label: g.label }));
const blankCost = { id: null, cost_date: "", description: "", amount: "", note: "", cost_group: DEFAULT_COST_GROUP };

export function TypedCostDialog({ open, onOpenChange, cost, onSave, onDelete }) {
  const [draft, setDraft] = useState(blankCost);
  const [seen, setSeen] = useState(null);
  if (open && seen !== (cost ?? "new")) {
    setSeen(cost ?? "new");
    setDraft(cost ? { ...blankCost, ...cost, amount: String(cost.amount), cost_group: cost.group ?? cost.cost_group } : blankCost);
  }
  if (!open && seen !== null) setSeen(null);
  const amount = parseTyped(draft.amount);
  const ok = draft.description.trim() && amount !== null && Number.isFinite(amount);
  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      crumbs={["OPEX", cost ? "Edit Typed cost" : "Add Typed cost"]}
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        onSave({ ...draft, description: draft.description.trim(), amount });
        onOpenChange(false);
      }}
      footerStart={
        cost && (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => {
              onDelete(cost.id);
              onOpenChange(false);
            }}
          >
            Delete
          </Button>
        )
      }
      actions={
        <Button type="submit" variant="primary" disabled={!ok}>
          Save Typed cost
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">A cost Odoo does not have, such as a fee paid in cash. It counts in the group you pick.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Description" containerClassName="sm:col-span-2" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} autoFocus />
        <Input label="Amount (pesos)" inputMode="decimal" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
        <Input label="Date" type="date" value={draft.cost_date ?? ""} onChange={(e) => setDraft({ ...draft, cost_date: e.target.value })} />
        <SelectField label="Counts as" options={GROUP_OPTIONS} value={draft.cost_group} onChange={(v) => setDraft({ ...draft, cost_group: v })} />
        <Input label="Note (optional)" value={draft.note ?? ""} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
      </div>
    </ModalShell>
  );
}

export function LeaveOutDialog({ expense, onOpenChange, onConfirm }) {
  const [note, setNote] = useState("");
  return (
    <ConfirmDialog
      open={Boolean(expense)}
      onOpenChange={(o) => {
        if (!o) setNote("");
        onOpenChange(o);
      }}
      title={`Leave out "${expense?.description ?? ""}"?`}
      description="It stays on the list, crossed out, and stops counting. Put it back any time."
      confirmLabel="Leave out"
      onConfirm={() => {
        onConfirm(expense, note);
        setNote("");
      }}
    >
      <Input label="Why (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
    </ConfirmDialog>
  );
}

/** A zero-price line's price, typed in place (opens under the line). */
export function PriceForm({ line, onSave, onClear }) {
  const [text, setText] = useState(line.typedPrice == null ? "" : String(line.typedPrice));
  const n = parseTyped(text);
  const ok = n !== null && Number.isFinite(n) && n >= 0;
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) onSave(n);
      }}
    >
      <Input
        label="Unit price (pesos)"
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        containerClassName="w-48"
        title="In pesos, even for a P0 in another currency"
      />
      <Button type="submit" size="sm" variant="outline" disabled={!ok}>
        Save price
      </Button>
      {line.typedPrice != null && (
        <Button type="button" size="sm" variant="ghost" onClick={onClear}>
          Back to Odoo&apos;s zero
        </Button>
      )}
      <p className="basis-full text-xs text-muted-foreground">
        Odoo has this line at zero. {line.quantity} × the price you type × {line.sharePercent}% counts to this S0.
      </p>
    </form>
  );
}

export function NewReportDialog({ open, onOpenChange, rows, onOpen }) {
  const [text, setText] = useState("");
  const s0 = normalizeS0(text);
  return (
    <ModalShell
      open={open}
      onOpenChange={(n) => {
        if (!n) setText("");
        onOpenChange(n);
      }}
      crumbs={["OPEX", "New OPEX Report"]}
      onSubmit={(e) => {
        e.preventDefault();
        if (!s0) return;
        if (rows.some((r) => r.s0 === s0)) {
          toast(`${s0} already has an OPEX Report. Opening it.`);
          onOpenChange(false);
          onOpen(s0);
        } else toast("Prototype: a new report is not saved here.");
      }}
      actions={
        <Button type="submit" variant="primary" disabled={!s0}>
          Start OPEX Report
        </Button>
      }
    >
      <p className="text-sm text-muted-foreground">An OPEX Report is for one S0. It reads what Odoo says the project spent.</p>
      <Input label="S0 number" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. S06637" autoFocus />
    </ModalShell>
  );
}

/* ---------- The list ---------- */

const HEALTH_OPTIONS = [
  { value: ALL, label: "Any revenue" },
  ...Object.entries(HEALTH).map(([value, h]) => ({ value, label: h.label })),
];
const READ_OPTIONS = [
  { value: ALL, label: "Read any time" },
  { value: "week", label: "Read this week" },
  { value: "stale", label: "Not read for 30 days" },
];

export function useListFilters(rows) {
  const [search, setSearch] = useState("");
  const [health, setHealth] = useState(null);
  const [readWhen, setReadWhen] = useState(null);

  const scoped = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !`${r.s0} ${r.project ?? ""}`.toLowerCase().includes(q)) return false;
      const age = listAgeDays(r.readAt);
      if (readWhen === "week" && (age === null || age > 7)) return false;
      if (readWhen === "stale" && age !== null && age < 30) return false;
      return true;
    });
  }, [rows, search, readWhen]);
  const filtered = useMemo(() => (health ? scoped.filter((r) => r.health === health) : scoped), [scoped, health]);

  const hasActiveFilters = search !== "" || health !== null || readWhen !== null;
  const clear = () => {
    setSearch("");
    setHealth(null);
    setReadWhen(null);
  };
  return { search, setSearch, health, setHealth, readWhen, setReadWhen, scoped, filtered, hasActiveFilters, clear };
}

export function ListFilterBar({ f, withHealthChip = true, actions }) {
  return (
    <FilterBar
      search={{ value: f.search, onChange: f.setSearch, placeholder: "Search S0 or project" }}
      chips={
        <>
          {withHealthChip && (
            <FilterSelect
              icon={TrendingDown}
              label="Revenue"
              options={HEALTH_OPTIONS}
              value={f.health ?? ALL}
              onChange={(v) => f.setHealth(v === ALL ? null : v)}
              allValue={ALL}
              className={CHIP}
              wrapperClassName={CHIP_WRAPPER}
            />
          )}
          <FilterSelect
            icon={CalendarClock}
            label="Last read"
            options={READ_OPTIONS}
            value={f.readWhen ?? ALL}
            onChange={(v) => f.setReadWhen(v === ALL ? null : v)}
            allValue={ALL}
            className={CHIP}
            wrapperClassName={CHIP_WRAPPER}
          />
        </>
      }
      actions={actions}
      hasActiveFilters={f.hasActiveFilters}
      onClearAll={f.clear}
    />
  );
}

export const EXPORT_HEADER = ["S0", "Project", "Contract price", "Product cost", "Operation & Admin", "Marketing", "Actual OPEX", "Revenue", "Revenue %", "Last read"];
export const exportRows = (rows) =>
  rows.map((r) => [r.s0, r.project ?? "", r.contract, r.product, r.opsAdmin, r.marketing, r.actualOpex, r.revenue, r.pct, r.readAt ? listDate(r.readAt) : ""]);

const COLUMNS = [
  { key: "s0", label: "S0", phone: "title" },
  { key: "contract", label: "Contract price", right: true, phone: "meta" },
  { key: "product", label: "Product cost", right: true, narrow: true, phone: "hide" },
  { key: "opsAdmin", label: "Operation & Admin", right: true, narrow: true, phone: "hide" },
  { key: "marketing", label: "Marketing", right: true, narrow: true, phone: "hide" },
  { key: "actualOpex", label: "Actual OPEX", right: true, phone: "meta" },
  { key: "revenue", label: "Revenue", right: true, phone: "meta" },
  { key: "pct", label: "Revenue %", right: true, phone: "hide" },
  { key: "readAt", label: "Last read", narrow: true, phone: "hide" },
  { key: "health", label: "State", right: true, phone: "badge" },
];
const SORT = Object.fromEntries(COLUMNS.map((c) => [c.key, c.key === "readAt" ? (r) => (r.readAt ? new Date(r.readAt).getTime() : null) : (r) => r[c.key]]));
const blank = <span className="font-normal text-muted-foreground">—</span>;
const money = (v) => (v === null || v === undefined ? blank : peso(v));

/**
 * The list table, built like the Purchasing lists: sortable heads that never wrap, the S0 in mono
 * over the project, 12px figures, a state badge last, a pager. `totals` is "footer" (the IPAS band
 * under the table), "row" (the S0 Evaluation's totals row) or null.
 */
export function ListTable({ rows, onOpen, onHover, totals = "footer", search, tintBelow = false, activeS0 }) {
  const { sorted, sort, toggle } = useTableSort(rows, SORT);
  const paging = usePaging(sorted);
  const t = {
    contract: sumOf(rows, "contract"),
    product: sumOf(rows, "product"),
    opsAdmin: sumOf(rows, "opsAdmin"),
    marketing: sumOf(rows, "marketing"),
    actualOpex: sumOf(rows, "actualOpex"),
    revenue: sumOf(rows, "revenue"),
  };
  const totalPct = t.contract ? Math.round((t.revenue / t.contract) * 10000) / 100 : null;
  return (
    <div className="rounded-xl border border-border bg-card [&_thead_tr]:rounded-t-xl [&_th:first-child]:rounded-tl-xl [&_th:last-child]:rounded-tr-xl">
      <Table tableId="opex-proto" stackOnPhone className="md:min-w-[60rem]">
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            {COLUMNS.map((c) => (
              <SortHead
                key={c.key}
                id={`opex-proto-${c.key}`}
                phone={c.phone}
                sortKey={c.key}
                sort={sort}
                onSort={toggle}
                className={`${HEAD} ${c.right ? "text-right" : ""} ${c.narrow ? "hidden md:table-cell" : ""}`}
              >
                {c.label}
              </SortHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {paging.rows.map((r) => {
            const lower = tintBelow && (r.health === "below" || r.health === "loss");
            return (
              <TableRow
                key={r.id}
                tabIndex={0}
                onClick={() => onOpen(r.s0)}
                onMouseEnter={() => onHover?.(r.s0)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && e.target === e.currentTarget) onOpen(r.s0);
                }}
                data-active={activeS0 === r.s0 ? "true" : undefined}
                className={`group cursor-pointer outline-none focus-visible:bg-muted data-[active=true]:bg-muted ${lower ? "bg-amber-a2 hover:bg-amber-a3" : ""}`}
              >
                <IdentityCell reference={r.s0} name={r.project ?? "No Project tag in Odoo"} search={search} />
                <TableCell className="text-right text-xs tabular-nums max-md:text-left">{money(r.contract)}</TableCell>
                <TableCell className="hidden text-right text-xs tabular-nums md:table-cell">{money(r.product)}</TableCell>
                <TableCell className="hidden text-right text-xs tabular-nums md:table-cell">{money(r.opsAdmin)}</TableCell>
                <TableCell className="hidden text-right text-xs tabular-nums md:table-cell">{money(r.marketing)}</TableCell>
                <TableCell className="text-right text-xs tabular-nums max-md:text-left">{money(r.actualOpex)}</TableCell>
                <TableCell className={`text-right text-xs tabular-nums max-md:text-left ${r.health === "loss" ? "font-semibold text-red-11" : ""}`}>{money(r.revenue)}</TableCell>
                <TableCell className="text-right text-xs tabular-nums">{r.pct === null ? blank : pct(r.pct)}</TableCell>
                <TableCell className="hidden text-xs text-muted-foreground md:table-cell">{r.readAt ? listDate(r.readAt) : "Not read"}</TableCell>
                <StateCell state={r.health} tones={Object.fromEntries(Object.entries(HEALTH).map(([k, h]) => [k, h.theme]))} label={HEALTH[r.health].label} />
              </TableRow>
            );
          })}
          {totals === "row" && (
            <TableRow className="bg-muted/40 font-semibold hover:bg-muted/40 max-md:hidden!">
              <TableCell className="text-xs">
                Total of {rows.length} {rows.length === 1 ? "report" : "reports"} shown
              </TableCell>
              <TableCell className="text-right text-xs tabular-nums">{money(t.contract)}</TableCell>
              <TableCell className="hidden text-right text-xs tabular-nums md:table-cell">{money(t.product)}</TableCell>
              <TableCell className="hidden text-right text-xs tabular-nums md:table-cell">{money(t.opsAdmin)}</TableCell>
              <TableCell className="hidden text-right text-xs tabular-nums md:table-cell">{money(t.marketing)}</TableCell>
              <TableCell className="text-right text-xs tabular-nums">{money(t.actualOpex)}</TableCell>
              <TableCell className="text-right text-xs tabular-nums">{money(t.revenue)}</TableCell>
              <TableCell className="text-right text-xs tabular-nums">{totalPct === null ? blank : pct(totalPct)}</TableCell>
              <TableCell className="hidden md:table-cell" />
              <TableCell />
            </TableRow>
          )}
        </TableBody>
      </Table>
      {totals === "footer" && (
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 border-t border-border bg-muted/30 px-4 py-2.5 text-xs">
          <span className="font-bold uppercase tracking-wider text-muted-foreground">Totals for {rows.length} shown</span>
          <span className="tabular-nums text-foreground">
            Contract price {money(t.contract)} · Actual OPEX {money(t.actualOpex)} · Revenue {money(t.revenue)}
            {totalPct !== null && ` (${pct(totalPct)})`}
          </span>
        </div>
      )}
      <TablePager {...paging} noun="reports" />
    </div>
  );
}

export function NewButton({ onClick }) {
  return (
    <Button size="sm" onClick={onClick} className="gap-1.5">
      <Plus size={14} />
      New OPEX Report
    </Button>
  );
}
