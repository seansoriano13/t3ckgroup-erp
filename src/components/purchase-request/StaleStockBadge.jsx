import StatusBadge from "../StatusBadge";
import { STATUS_THEME } from "../../constants/statusTheme";

/**
 * #501 — marks a stock reading older than STOCK_STALE_AFTER_MS, wherever the
 * Purchase Request shows stock: the add-item picker and a saved item's row.
 */
export default function StaleStockBadge({ className = "" }) {
  return (
    <StatusBadge
      label="Stale"
      theme={STATUS_THEME.AMBER}
      title="Stock read more than 24 hours ago"
      className={className}
    />
  );
}
