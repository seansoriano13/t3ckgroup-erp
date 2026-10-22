import Dropdown from "@/components/ui/Dropdown";
import { FilterOptionList, MultiFilterOptionList } from "@/components/ui/FilterDropdown";
import { Input } from "@/components/ui/input";
import PropertyPill from "@/components/ui/PropertyPill";
import { cn } from "@/lib/utils";
import {
  TRANSMITTAL_ORIGIN,
  TRANSMITTAL_ORIGIN_LABELS,
  TRANSMITTAL_PRIORITIES,
  TRANSMITTAL_PRIORITY_LABELS,
} from "@/constants/transmittals";
import { companyOptions } from "@/utils/transmittals";

const ORIGIN_OPTIONS = Object.values(TRANSMITTAL_ORIGIN).map((value) => ({ value, label: TRANSMITTAL_ORIGIN_LABELS[value] }));
const PRIORITY_OPTIONS = TRANSMITTAL_PRIORITIES.map((value) => ({ value, label: TRANSMITTAL_PRIORITY_LABELS[value] }));
const CHECK_OPTIONS = [
  { value: "warehouse", label: "Warehouse" },
  { value: "technical", label: "TCA Technical" },
];

const POPOVER = "popover-enter z-[10001] max-h-[70vh] w-64 overflow-y-auto rounded-xl bg-popover p-1 shadow-2xl ring-1 ring-mauve-6";

/** One header property: a pill that names its value and opens its options. A property the slip still needs reads dashed. */
function Property({ label, value, needed, children }) {
  return (
    <Dropdown
      usePortal
      matchTriggerWidth={false}
      popoverClassName={POPOVER}
      trigger={
        <PropertyPill isActive={Boolean(value)} className={cn("h-8 text-[13px]", needed && "border-dashed border-amber-8 text-amber-11")}>
          <span className="font-medium text-muted-foreground">{label}</span>
          {value && <span className="max-w-56 truncate font-bold text-foreground">{value}</span>}
        </PropertyPill>
      }
    >
      {children}
    </Dropdown>
  );
}

function OthersBox({ value, onChange, label }) {
  return (
    <div className="border-t border-border p-2">
      <Input className="h-8 text-[13px]" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Others" aria-label={label} />
    </div>
  );
}

const labelOf = (options, value) => options.find((o) => o.value === value)?.label;

/**
 * The slip's header as a row of property pills (Origin, Priority, Company,
 * Location, Checking, Product, References). Every option is one click away and
 * the pill reads back the choice. `gaps` (from slipGaps) marks the pills the
 * slip still needs.
 */
export default function SlipProperties({
  header,
  setField,
  patchHeader,
  productIds,
  referenceIds,
  setProductIds,
  setReferenceIds,
  companyNames,
  productOptions,
  referenceOptions,
  locationChoices,
  gaps,
}) {
  const needs = (key) => gaps.some((g) => g.key === key);
  const products = productOptions.filter((o) => productIds.includes(o.id)).map((o) => o.label);
  const references = referenceOptions.filter((o) => referenceIds.includes(o.id)).map((o) => o.label);
  const entityOptions = companyOptions(companyNames, header.entity);
  const checkValues = [header.checkWarehouse && "warehouse", header.checkTechnical && "technical"].filter(Boolean);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Property label="Origin" value={labelOf(ORIGIN_OPTIONS, header.origin)} needed={needs("origin")}>
          {({ close }) => <FilterOptionList options={ORIGIN_OPTIONS} value={header.origin} onChange={setField("origin")} close={close} />}
        </Property>
        {header.origin === TRANSMITTAL_ORIGIN.OTHER && (
          <Input
            className="h-8 w-40 rounded-full text-[13px]"
            value={header.originOther}
            onChange={(e) => setField("originOther")(e.target.value)}
            placeholder="Which origin?"
            aria-label="Origin, others"
          />
        )}
        <Property label="Priority" value={labelOf(PRIORITY_OPTIONS, header.priority)} needed={needs("priority")}>
          {({ close }) => <FilterOptionList options={PRIORITY_OPTIONS} value={header.priority} onChange={setField("priority")} close={close} />}
        </Property>
        <Property label="Company" value={header.entity} needed={needs("entity")}>
          {({ close }) => <FilterOptionList options={entityOptions} value={header.entity} onChange={setField("entity")} close={close} />}
        </Property>
        <Property label="Location" value={labelOf(locationChoices, header.itemLocationId)}>
          {({ close }) => (
            <FilterOptionList
              options={locationChoices}
              value={header.itemLocationId}
              onChange={(value) => setField("itemLocationId")(value === header.itemLocationId ? null : value)}
              close={close}
            />
          )}
        </Property>
        <Property
          label="Checking"
          value={[header.checkWarehouse && "Warehouse", header.checkTechnical && "TCA Technical", header.checkOther].filter(Boolean).join(" + ")}
          needed={needs("checking")}
        >
          <MultiFilterOptionList
            options={CHECK_OPTIONS}
            values={checkValues}
            onChange={(values) => patchHeader({ checkWarehouse: values.includes("warehouse"), checkTechnical: values.includes("technical") })}
          />
          <OthersBox value={header.checkOther} onChange={setField("checkOther")} label="Checking, others" />
        </Property>
        <Property label="Product" value={[...products, header.productOther].filter(Boolean).join(", ")}>
          <MultiFilterOptionList
            options={productOptions.map((o) => ({ value: o.id, label: o.label }))}
            values={productIds}
            onChange={setProductIds}
          />
          <OthersBox value={header.productOther} onChange={setField("productOther")} label="Product, others" />
        </Property>
        <Property label="References" value={references.length ? `${references.length} ticked` : ""}>
          <MultiFilterOptionList
            options={referenceOptions.map((o) => ({ value: o.id, label: o.label }))}
            values={referenceIds}
            onChange={setReferenceIds}
          />
        </Property>
      </div>
      {references.length > 0 && <p className="mt-2 text-[12px] text-muted-foreground">References: {references.join(" · ")}</p>}
    </div>
  );
}
