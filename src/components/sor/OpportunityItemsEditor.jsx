import { Plus, Trash2 } from "lucide-react";
import { formatPHP } from "../../constants/sor";
import { Button } from "../ui/button";
import { Input } from "@/components/ui/input";

const emptyRow = () => ({ product_name: "", unit: "", quantity: 1, unit_price: "" });

const lineTotal = (item) =>
  (Number(item.quantity) || 0) * (Number(item.unit_price) || 0);

/**
 * The product list behind an opportunity's Expected Value. Controlled —
 * `items` never carries a DB id, so edits are keyed by array index and the
 * parent form sends the whole list on save (see
 * opportunityService.replaceItems).
 */
export default function OpportunityItemsEditor({ items, onChange }) {
  const updateRow = (idx, key, value) => {
    const next = items.slice();
    next[idx] = { ...next[idx], [key]: value };
    onChange(next);
  };

  const addRow = () => onChange([...items, emptyRow()]);
  const removeRow = (idx) => onChange(items.filter((_, i) => i !== idx));

  const total = items.reduce((sum, it) => sum + lineTotal(it), 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
          Product List
        </label>
        <Button
          type="button"
          variant="link"
          onClick={addRow}
          className="h-auto p-0 text-[12px] gap-1"
        >
          <Plus size={13} /> Add Item
        </Button>
      </div>

      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground/70 italic bg-muted/30 border border-border rounded-xl px-3 py-2.5">
          No items yet — Product Line Total will show ₱0.00 until at least one is added.
        </p>
      ) : (
        <div className="border border-border rounded-xl overflow-x-auto">
          <div className="min-w-[600px] divide-y divide-border">
            <div className="grid grid-cols-12 gap-2 px-3 py-1.5 bg-muted/40 text-[9px] font-bold text-muted-foreground uppercase tracking-widest">
              <span className="col-span-5">Product</span>
              <span className="col-span-2">Unit</span>
              <span className="col-span-1">Qty</span>
              <span className="col-span-2">Unit Price</span>
              <span className="col-span-2 text-right">Total</span>
            </div>
            {items.map((item, idx) => (
              <div
                key={idx}
                className="grid grid-cols-12 gap-2 px-3 py-2 items-center bg-muted/10"
              >
                <Input
                  value={item.product_name}
                  onChange={(e) => updateRow(idx, "product_name", e.target.value)}
                  placeholder="e.g. Boom Lift"
                  containerClassName="col-span-5 min-w-0" className="border-0 bg-transparent rounded-none px-0 py-0 shadow-none focus-visible:ring-0 h-auto bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none font-medium"
                />
                <Input
                  value={item.unit}
                  onChange={(e) => updateRow(idx, "unit", e.target.value)}
                  placeholder="Units"
                  containerClassName="col-span-2 min-w-0" className="border-0 bg-transparent rounded-none px-0 py-0 shadow-none focus-visible:ring-0 h-auto bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none font-medium"
                />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.quantity}
                  onChange={(e) => updateRow(idx, "quantity", e.target.value)}
                  containerClassName="col-span-1 min-w-0" className="border-0 bg-transparent rounded-none px-0 py-0 shadow-none focus-visible:ring-0 h-auto bg-transparent text-sm text-foreground outline-none font-medium"
                />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.unit_price}
                  onChange={(e) => updateRow(idx, "unit_price", e.target.value)}
                  placeholder="0.00"
                  containerClassName="col-span-2 min-w-0" className="border-0 bg-transparent rounded-none px-0 py-0 shadow-none focus-visible:ring-0 h-auto bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none font-medium"
                />
                <div className="col-span-1 text-xs font-bold text-foreground text-right truncate">
                  {formatPHP(lineTotal(item))}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => removeRow(idx)}
                  className="col-span-1 justify-self-end text-muted-foreground hover:text-red-500"
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {items.length > 0 && (
        <div className="flex items-center justify-end gap-2 pt-1 pr-1">
          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
            Product Line Total
          </span>
          <span className="text-sm font-black text-foreground">
            {formatPHP(total)}
          </span>
        </div>
      )}
    </div>
  );
}
