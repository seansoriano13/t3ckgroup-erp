import { Calendar as CalendarIcon, ChevronDown, X } from "lucide-react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { cn } from "@/lib/utils";
import { periodValue } from "@/lib/period";
import Dropdown from "./Dropdown";
import { FilterOptionList } from "./FilterDropdown";

const TIMEFRAMES = [
  { value: "DAILY", label: "Daily" },
  { value: "WEEKLY", label: "Weekly" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "YEARLY", label: "Yearly" },
];

function periodLabel(timeframe, value) {
  if (!value) {
    return timeframe === "YEARLY" ? "Select Year" : timeframe === "MONTHLY" ? "Select Month" : "Select Date";
  }
  if (timeframe === "YEARLY") return value;
  if (timeframe === "MONTHLY") {
    return new Date(value).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  }
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * A timeframe (Daily / Weekly / Monthly / Yearly) and the day, month or year it
 * points at, as one chip for a FilterBar. Picking a timeframe moves the date to
 * today's day, month or year; the date is cleared with the x.
 *
 * `value` is "" when no date narrows the list.
 */
export default function PeriodFilter({ timeframe, onTimeframeChange, value, onChange, className }) {
  const currentTimeframe = TIMEFRAMES.find((t) => t.value === timeframe)?.label ?? "Daily";

  return (
    <div
      className={cn(
        "flex h-9 max-w-full shrink-0 items-center rounded-lg border shadow-sm transition-all",
        value ? "bg-muted ring-1 ring-mauve-4" : "border-border bg-card",
        className,
      )}
    >
      <Dropdown
        usePortal
        matchTriggerWidth={false}
        className="h-full w-auto border-r border-border"
        trigger={({ isOpen }) => (
          <button
            type="button"
            aria-label={`Timeframe: ${currentTimeframe}`}
            className="flex h-full min-w-[84px] items-center justify-center gap-2 rounded-l-lg pl-3 pr-2 transition-colors hover:bg-muted/60"
          >
            <span className="text-[10px] font-bold uppercase tracking-widest text-foreground">{currentTimeframe}</span>
            <ChevronDown size={10} className={cn("text-muted-foreground transition-transform", isOpen && "rotate-180")} />
          </button>
        )}
      >
        {({ close }) => (
          <FilterOptionList
            options={TIMEFRAMES}
            value={timeframe}
            onChange={(next) => {
              onTimeframeChange(next);
              onChange(periodValue(next, new Date()));
            }}
            close={close}
          />
        )}
      </Dropdown>

      <Dropdown
        usePortal
        matchTriggerWidth={false}
        placement="bottom-start"
        className="h-full w-auto"
        trigger={({ isOpen }) => (
          <button
            type="button"
            aria-label={`Date: ${periodLabel(timeframe, value)}`}
            className="flex h-full items-center gap-2 px-2.5"
          >
            <CalendarIcon size={14} className={cn("shrink-0", value || isOpen ? "text-foreground" : "text-muted-foreground")} />
            <span className={cn("truncate text-left text-[13px]", value ? "font-medium text-foreground" : "text-muted-foreground")}>
              {periodLabel(timeframe, value)}
            </span>
          </button>
        )}
      >
        {({ close }) => (
          <div className="p-1">
            <DatePicker
              selected={value ? new Date(value) : null}
              onChange={(date) => {
                onChange(date ? periodValue(timeframe, date) : "");
                if (date) close();
              }}
              showMonthYearPicker={timeframe === "MONTHLY"}
              showYearPicker={timeframe === "YEARLY"}
              inline
            />
          </div>
        )}
      </Dropdown>

      {value && (
        <button
          type="button"
          aria-label="Clear date"
          onClick={() => onChange("")}
          className="mr-1.5 rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}
