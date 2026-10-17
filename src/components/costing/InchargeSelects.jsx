import { SelectCell } from "./GridCell";

/**
 * Who answers for the matrix, or for one row (#268): a Sales incharge from the Deal Team and a
 * Purchasing incharge with Purchasing access. Names only: it grants no access and notifies
 * nobody. `emptyLabel` is what unset means here ("Not set" on the matrix, "Matrix default" on a
 * row that can override it). A select is read-only outside the column's band.
 */
export default function InchargeSelects({
  sales,
  purchasing,
  salesOptions,
  purchasingOptions,
  canSales,
  canPurchasing,
  onSave,
  labelPrefix = "",
  emptyLabel = "Not set",
}) {
  // A named person who is no longer an option (left the Deal Team) still reads by name.
  const withCurrent = (options, current) =>
    current && !options.some((o) => o.value === current) ? [...options, { value: current, label: "Former team member" }] : options;
  const withEmpty = (options) => [{ value: "__empty__", label: emptyLabel }, ...options];
  const pick = (field) => (next) => onSave({ [field]: next === "__empty__" ? null : next });

  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Sales incharge</span>
        <SelectCell
          label={`${labelPrefix}Sales incharge`}
          className="w-44"
          clearable={false}
          readOnly={!canSales}
          value={sales ?? "__empty__"}
          options={withEmpty(withCurrent(salesOptions, sales))}
          onSave={pick("sales")}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Purchasing incharge</span>
        <SelectCell
          label={`${labelPrefix}Purchasing incharge`}
          className="w-44"
          clearable={false}
          readOnly={!canPurchasing}
          value={purchasing ?? "__empty__"}
          options={withEmpty(withCurrent(purchasingOptions, purchasing))}
          onSave={pick("purchasing")}
        />
      </div>
    </div>
  );
}
