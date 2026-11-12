import { db } from "@/test/db/store";
import { requiredKindsByPart } from "@/utils/ipasDocuments";

/**
 * Makes an IPAS "ready" for the rail's second stretch, "Sign the final IPAS":
 * every required file attached and Logistics signed (which
 * also stands for the Item Location and the Transmittal). Seed the IPAS with
 * computation_status "lc_odoo_done" so Landed Cost is final. `logisticsBy` is the
 * person the Logistics sign-off is recorded for.
 */
export function makeReady(row, logisticsBy, { source = "local" } = {}) {
  const wanted = Object.values(requiredKindsByPart({ options: db.rows("ipas_options") }, source)).flat();
  for (const kind of wanted) {
    db.seed("ipas_documents", {
      ipas_id: row.id,
      kind_id: kind.id,
      label: null,
      attachment_url: `https://res.cloudinary.com/demo/raw/upload/${kind.id}.pdf`,
      purchasing_has: true,
      finance_has: true,
    });
  }
  db.seed("ipas_signoffs", {
    ipas_id: row.id,
    section: 8,
    role: "approved",
    signed_by: logisticsBy.id,
    signed_at: "2026-09-05T06:00:00.000Z",
  });
}
