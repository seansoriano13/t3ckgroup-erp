import { useState } from "react";

import { cn } from "@/lib/utils";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { SelectField } from "../ui/SelectField";
import StatusBadge from "../StatusBadge";
import { formatPHP } from "../../constants/sor";
import { refusalMessage } from "./gridFormat";
import { stockBadge, STOCK_BADGE_THEME } from "../../constants/stock";

/**
 * One cell you can type in (the Costing Matrix grid). Saves when you leave it, and only if it changed.
 * A refusal (a band error, a bad number) shows under the cell and leaves what you typed there.
 * Read-only where the viewer is outside the column's band.
 */
export function Cell({
  value,
  onSave,
  readOnly,
  label,
  noun = label,
  multiline = false,
  numeric = false,
  money = false,
  required = false,
  align = "left",
  step = "0.01",
  placeholder,
  className,
}) {
  const shown = value === null || value === undefined ? "" : String(value);
  const [draft, setDraft] = useState(shown);
  const [seen, setSeen] = useState(shown);
  const [error, setError] = useState(null);
  const [focused, setFocused] = useState(false);

  // Follow the saved value when it changes under us (a refresh), unless typing.
  if (seen !== shown && !focused) {
    setSeen(shown);
    setDraft(shown);
  }

  if (readOnly) {
    return (
      <span className={multiline ? "block whitespace-pre-line text-sm text-foreground" : "block text-sm tabular-nums text-foreground"} aria-label={label}>
        {shown === "" ? "—" : money ? formatPHP(Number(shown)) : shown}
      </span>
    );
  }

  const commit = async () => {
    setFocused(false);
    if (draft === shown) return;
    let next = draft;
    if (numeric) {
      const text = draft.trim();
      if (text === "") {
        if (required) return setError(`${noun} is needed.`);
        next = null;
      } else {
        const n = Number(text);
        if (!Number.isFinite(n) || n < 0 || (required && n === 0)) return setError(`${noun} must be a number${required ? " above zero" : ""}.`);
        next = n;
      }
    }
    try {
      setError(null);
      await onSave(next);
    } catch (err) {
      setError(refusalMessage(err));
    }
  };

  const shared = {
    value: draft,
    "aria-label": label,
    "aria-invalid": error ? true : undefined,
    placeholder,
    onFocus: () => setFocused(true),
    onChange: (event) => {
      setDraft(event.target.value);
      if (error) setError(null);
    },
    onBlur: commit,
  };

  return (
    <div className={cn("space-y-1", className)}>
      {multiline ? (
        <Textarea {...shared} rows={3} className="min-h-[64px] px-2 py-1.5 text-sm" />
      ) : (
        <Input
          {...shared}
          type={numeric ? "number" : "text"}
          min={numeric ? 0 : undefined}
          step={numeric ? step : undefined}
          className={`h-8 px-2 text-sm ${align === "right" ? "text-right tabular-nums" : ""}`}
        />
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

const NONE = "__none__";

/**
 * A cell that picks one of a few words (Status, Availability, Source, Completeness). Saves on choosing.
 * A refusal shows under the cell. Read-only where the viewer is outside the column's band.
 * With `clearable`, a dash option clears it back to nothing.
 */
export function SelectCell({ value, options, onSave, readOnly, label, clearable = true, placeholder = "—", className }) {
  const [error, setError] = useState(null);
  const current = options.find((option) => option.value === value);

  if (readOnly) {
    return (
      <span className="block text-sm text-foreground" aria-label={label}>
        {current?.label ?? "—"}
      </span>
    );
  }

  const choose = async (next) => {
    try {
      setError(null);
      await onSave(next === NONE ? null : next);
    } catch (err) {
      setError(refusalMessage(err));
    }
  };

  return (
    <div className={cn("space-y-1", className)}>
      <SelectField
        aria-label={label}
        size="sm"
        className="w-full"
        placeholder={placeholder}
        options={clearable ? [{ value: NONE, label: "—" }, ...options] : options}
        value={value ?? (clearable ? NONE : "")}
        onChange={choose}
      />
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** The stock badge for a product on the SOR's stock snapshot (a Tender Line picked from an SOR line, or a Component with an Odoo product id). */
export function StockBadge({ quantity, odooProductId, snapshotData }) {
  const product = odooProductId ? snapshotData?.products?.[odooProductId] || null : null;
  const badge = stockBadge({ quantity, product, odooProductId });
  return <StatusBadge label={badge.label} theme={STOCK_BADGE_THEME[badge.kind]} title="Stock" />;
}
