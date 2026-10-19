import { useMemo } from "react";
import { CircleDot, GitBranch, KeyRound, Workflow } from "lucide-react";
import FilterBar from "../ui/FilterBar";
import { FilterSelect } from "../ui/FilterDropdown";
import PeriodFilter from "../ui/PeriodFilter";
import {
  DEFAULT_MY_SORS_FILTERS,
  MY_SORS_ALL,
  MY_SORS_CURRENT,
  MY_SORS_ENDED,
  MY_SORS_FULL,
  MY_SORS_IN_WINDOW,
  SOURCE_CALLED_IN,
  SOURCE_DEAL_TEAM,
  SOURCE_MENTION,
  hasActiveMySorsFilters, mySorsFilterOptions,
} from "../../utils/mySorsFilters";

const ACCESS_OPTIONS = [
  { value: MY_SORS_CURRENT, label: "Current access" },
  { value: MY_SORS_ALL, label: "All access" },
  { value: MY_SORS_FULL, label: "Full" },
  { value: MY_SORS_IN_WINDOW, label: "In window" },
  { value: MY_SORS_ENDED, label: "Access ended" },
];

const VIA_OPTIONS = [
  { value: MY_SORS_ALL, label: "Any reason" },
  { value: SOURCE_DEAL_TEAM, label: "Deal Team" },
  { value: SOURCE_CALLED_IN, label: "Called in" },
  { value: SOURCE_MENTION, label: "Mentioned" },
];

const withAll = (label, values) => [{ value: MY_SORS_ALL, label }, ...values.map((v) => ({ value: v, label: v }))];

const chipProps = { className: "h-9 w-auto gap-2 px-2.5", wrapperClassName: "w-auto shrink-0" };

/**
 * My SORs' filter line (#478), the repo's one FilterBar: search, Access, Why
 * I'm here and Stage inline; Sales Flow and the period of the SOR's last
 * activity behind Filters. `filters` is `DEFAULT_MY_SORS_FILTERS`-shaped; the
 * pure module applies them (`applyMySorsFilters`).
 */
export default function MySorsFilterBar({ rows, filters, onChange, onClearAll, saveDefault }) {
  const options = useMemo(() => mySorsFilterOptions(rows), [rows]);
  const activeCount = [filters.flow !== MY_SORS_ALL, filters.period !== ""].filter(Boolean).length;

  return (
    <FilterBar
      search={{
        value: filters.search,
        onChange: (v) => onChange("search", v),
        placeholder: "Search reference, SOR code, client or project",
      }}
      chips={
        <>
          <FilterSelect
            {...chipProps}
            icon={KeyRound}
            label="Access"
            options={ACCESS_OPTIONS}
            value={filters.access}
            isActive={filters.access !== DEFAULT_MY_SORS_FILTERS.access}
            onChange={(v) => onChange("access", v)}
          />
          <FilterSelect
            {...chipProps}
            icon={CircleDot}
            label="Why I'm here"
            options={VIA_OPTIONS}
            value={filters.via}
            onChange={(v) => onChange("via", v)}
          />
          <FilterSelect
            {...chipProps}
            icon={GitBranch}
            label="Stage"
            options={withAll("All Stages", options.stage)}
            value={filters.stage}
            onChange={(v) => onChange("stage", v)}
          />
        </>
      }
      filters={
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <FilterSelect
            icon={Workflow}
            label="Sales Flow"
            options={withAll("All Sales Flows", options.flow)}
            value={filters.flow}
            onChange={(v) => onChange("flow", v)}
          />
          <PeriodFilter
            timeframe={filters.timeframe}
            onTimeframeChange={(v) => onChange("timeframe", v)}
            value={filters.period}
            onChange={(v) => onChange("period", v)}
          />
        </div>
      }
      activeCount={activeCount}
      saveDefault={saveDefault}
      hasActiveFilters={hasActiveMySorsFilters(filters)}
      onClearAll={onClearAll}
    />
  );
}
