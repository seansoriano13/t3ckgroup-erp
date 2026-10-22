import { TRANSMITTAL_ORIGIN_LABELS, TRANSMITTAL_PRIORITY_LABELS } from "@/constants/transmittals";
import { formatPreparedAt } from "@/utils/preparedAt";

/** The slip as read-only properties, in the same pill language as the new form. Only what is set shows. */
export default function SlipFacts({ t }) {
  const facts = [
    ["Origin", t.origin === "other" ? `Others: ${t.originOther ?? ""}` : TRANSMITTAL_ORIGIN_LABELS[t.origin]],
    ["Priority", TRANSMITTAL_PRIORITY_LABELS[t.priority] ?? t.priority],
    ["Company", t.entity],
    ["Location", t.itemLocation?.label],
    ["Checking", [t.checkWarehouse && "Warehouse", t.checkTechnical && "TCA Technical", t.checkOther].filter(Boolean).join(" + ")],
    ["Product", [...t.products.map((p) => p.label), t.productOther].filter(Boolean).join(", ")],
    ["References", t.references.map((r) => r.label).join(" · ")],
    ["IPAS", t.ipasNumbers.join(", ")],
  ].filter(([, v]) => v);
  return (
    <div className="space-y-2.5">
      <p className="text-[13px] text-muted-foreground">
        <span className="font-mono font-semibold text-foreground">{t.number}</span> · prepared {formatPreparedAt(t.preparedOn)}
        {t.preparedBy?.name ? ` by ${t.preparedBy.name}` : ""}
      </p>
      <div className="flex flex-wrap gap-2">
        {facts.map(([label, value]) => (
          <span key={label} className="inline-flex max-w-full items-baseline gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-[13px]">
            <span className="shrink-0 text-muted-foreground">{label}</span>
            <span className="min-w-0 truncate font-semibold text-foreground">{value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
