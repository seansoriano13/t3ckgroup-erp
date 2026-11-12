import { SelectCell } from "./GridCell";

/**
 * Who answers for the matrix, or for one row (#268): a Sales incharge from the Deal Team and a
 * Purchasing incharge with Purchasing access. The matrix also names its Technical in-charge (#909), who
 * alone gives the one Technical verdict; the picker lists the Technical sub-department. Names only: it
 * grants no access and notifies nobody. `emptyLabel` is what unset means here ("Not set" on the matrix,
 * "Matrix default" on a row that can override it). A select is read-only outside the column's band.
 * The Technical picker is drawn only when `technicalOptions` is passed (the matrix, not a row).
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
  technical,
  technicalOptions,
  canTechnical = false,
}) {
  // A named person who is no longer an option (left the Deal Team) still reads by name.
  const withCurrent = (options, current) =>
    current && !options.some((o) => o.value === current) ? [...options, { value: current, label: "Former team member" }] : options;
  const withEmpty = (options) => [{ value: "__empty__", label: emptyLabel }, ...options];
  const pick = (field) => (next) => onSave({ [field]: next === "__empty__" ? null : next });

  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-col gap-3 text-sm sm:flex-row sm:flex-wrap sm:items-start sm:gap-x-4 sm:gap-y-2">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
          <span className="text-xs font-medium text-muted-foreground">Sales incharge</span>
          <SelectCell
            label={`${labelPrefix}Sales incharge`}
            className="w-full sm:w-44"
            clearable={false}
            readOnly={!canSales}
            value={sales ?? "__empty__"}
            options={withEmpty(withCurrent(salesOptions, sales))}
            onSave={pick("sales")}
          />
        </div>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
          <span className="text-xs font-medium text-muted-foreground">Purchasing incharge</span>
          <SelectCell
            label={`${labelPrefix}Purchasing incharge`}
            className="w-full sm:w-44"
            clearable={false}
            readOnly={!canPurchasing}
            value={purchasing ?? "__empty__"}
            options={withEmpty(withCurrent(purchasingOptions, purchasing))}
            onSave={pick("purchasing")}
          />
        </div>
        {technicalOptions && (
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
            <span className="text-xs font-medium text-muted-foreground">Technical in-charge</span>
            <SelectCell
              label="Technical in-charge"
              className="w-full sm:w-44"
              clearable={false}
              readOnly={!canTechnical}
              value={technical ?? "__empty__"}
              options={withEmpty(withCurrent(technicalOptions, technical))}
              onSave={pick("technical")}
            />
          </div>
        )}
      </div>
      {technicalOptions && technicalOptions.length === 0 && (
        <p className="text-xs text-muted-foreground" data-testid="technical-empty">
          No one in Technical. Ask HR to set the sub-department.
        </p>
      )}
    </div>
  );
}
