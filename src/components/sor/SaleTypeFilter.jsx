import { GitBranch } from "lucide-react";
import Dropdown from "../ui/Dropdown";
import { FilterTrigger, FilterOptionList } from "../ui/FilterDropdown";
import { NO_SALE_TYPE } from "../../constants/sor";

/**
 * The register's Sale Type filter: All SORs, every Sale Type (archived ones
 * included, so an SOR registered against one stays findable), and the legacy
 * SORs that have no Sale Type at all.
 */
export default function SaleTypeFilter({ saleTypes, value, onChange, className = "min-w-0 flex-1" }) {
  const options = [
    { value: "ALL", label: "All SORs" },
    ...saleTypes.map((t) => ({ value: t.id, label: t.archived_at ? `${t.name} (archived)` : t.name })),
    { value: NO_SALE_TYPE, label: "No Sale Type (legacy)" },
  ];
  const label = options.find((o) => o.value === value)?.label || "All SORs";

  return (
    <Dropdown
      usePortal={true}
      className={className}
      trigger={({ isOpen }) => (
        <FilterTrigger icon={GitBranch} label={label} isActive={value !== "ALL"} isOpen={isOpen} />
      )}
    >
      {({ close }) => (
        <FilterOptionList options={options} value={value} onChange={onChange} close={close} />
      )}
    </Dropdown>
  );
}
