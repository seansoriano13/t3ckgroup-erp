import PropertyPills from "@/components/record/PropertyPills";
import { TRANSMITTAL_ORIGIN_LABELS, TRANSMITTAL_PRIORITY_LABELS } from "@/constants/transmittals";

/** The slip's headline facts as property pills (read-only here). Only what is set shows. */
export default function SlipFacts({ t }) {
  return (
    <PropertyPills
      items={[
        { label: "Origin", value: t.origin === "other" ? `Others: ${t.originOther ?? ""}` : TRANSMITTAL_ORIGIN_LABELS[t.origin] },
        { label: "Priority", value: TRANSMITTAL_PRIORITY_LABELS[t.priority] ?? t.priority },
        { label: "Company", value: t.entity },
        { label: "Location", value: t.itemLocation?.label },
        { label: "Checking", value: [t.checkWarehouse && "Warehouse", t.checkTechnical && "TCA Technical", t.checkOther].filter(Boolean).join(" + ") },
        { label: "Product", value: [...t.products.map((p) => p.label), t.productOther].filter(Boolean).join(", ") },
        { label: "References", value: t.references.map((r) => r.label).join(" · ") },
        { label: "IPAS", value: t.ipasNumbers.join(", ") },
      ]}
    />
  );
}
