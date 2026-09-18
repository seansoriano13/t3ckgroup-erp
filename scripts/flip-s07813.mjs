// Flips S07813's 46 'inside' product documents to 'quotation', so Odoo stops
// baking 62.7 MB of brochures into every quotation render.
//
// Writes the rollback array to a file before printing anything, because that
// response is the only exact undo and losing it means guessing.
//
// Put the token in .env.mirror (git-ignored, never bundled):
//   ODOO_ADMIN_TOKEN=<from Supabase > Edge Functions > Secrets>
//   node flip-s07813.mjs
//
// Add --rollback <file> to put the previous values back.
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const IDS = [
  1758, 1188, 1760, 1767, 1161, 1208, 1639, 1694, 2093, 1693, 1692, 1704, 783, 254,
  334, 206, 207, 1094, 209, 210, 211, 1042, 259, 1539, 1538, 1537, 1930, 858, 1932,
  1505, 128, 1411, 159, 160, 157, 158, 999, 1178, 1034, 1191, 1177, 1252, 1014,
  1764, 1542, 1506,
];

const parse = (file) =>
  Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.trimStart().startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
      }),
  );

const env = parse(".env");

// The token belongs in .env.mirror, alongside the other Odoo credentials: that
// file is git-ignored and no bundler reads it.
//
// It must NEVER be named VITE_ANYTHING. Vite compiles every VITE_-prefixed
// variable into the browser bundle, and this token authorises rewriting product
// configuration in the live ERP — as a VITE_ var it would ship in plain text to
// every visitor and be readable with View Source.
const mirrorEnv = existsSync(".env.mirror") ? parse(".env.mirror") : {};
const token = process.env.ODOO_ADMIN_TOKEN || mirrorEnv.ODOO_ADMIN_TOKEN;

if (!token) {
  console.error(
    "No ODOO_ADMIN_TOKEN found.\n\n" +
      "Add it to .env.mirror (git-ignored, never bundled):\n" +
      "  ODOO_ADMIN_TOKEN=<token from Supabase > Edge Functions > Secrets>\n\n" +
      "Do not put it in .env, and never prefix it with VITE_ — that would ship\n" +
      "it to every browser in the built bundle.",
  );
  process.exit(1);
}

const rollbackArg = process.argv.indexOf("--rollback");
let payload;

if (rollbackArg >= 0) {
  const saved = JSON.parse(readFileSync(process.argv[rollbackArg + 1], "utf8"));
  // Replay each previous value exactly, grouped by what it used to be.
  const groups = new Map();
  for (const d of saved.rollback) {
    const key = JSON.stringify(d.attached_on);
    if (!groups.has(key)) groups.set(key, { attachedOn: d.attached_on, ids: [] });
    groups.get(key).ids.push(d.id);
  }
  payload = [...groups.values()].map((g) => ({
    action: "setVisibility",
    documentIds: g.ids,
    attachedOn: g.attachedOn,
  }));
} else {
  payload = [{ action: "setVisibility", documentIds: IDS, attachedOn: "quotation" }];
}

for (const body of payload) {
  const res = await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/odoo-document-admin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.VITE_SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}`,
      "x-admin-token": token,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();

  if (!json.success) {
    console.error(`FAILED (HTTP ${res.status}): ${json.message}`);
    process.exit(1);
  }

  if (json.rollback) {
    const file = `flip-rollback-${body.attachedOn}-${IDS.length}.json`;
    writeFileSync(file, JSON.stringify(json, null, 2));
    console.log(`rollback written to ${file}  — KEEP THIS`);
  }

  const counts = {};
  for (const d of json.result || []) {
    const k = d.attached_on === false ? "(not set)" : d.attached_on;
    counts[k] = (counts[k] || 0) + 1;
  }
  console.log(`${json.result?.length ?? 0} document(s) now:`, counts);
}
