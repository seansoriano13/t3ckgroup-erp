#!/usr/bin/env node
/**
 * Mirrors every mergeable product brochure from Odoo to Cloudinary.
 *
 * Supabase is deliberately NOT in this path. The edge function proxy exists
 * only because a *browser* cannot reach Odoo directly (no CORS headers); Node
 * has no such restriction, so this talks to Odoo's JSON-RPC itself and pushes
 * straight to Cloudinary. Mirroring the whole catalogue therefore costs zero
 * Supabase egress, which is the entire point of doing it here rather than in
 * the app.
 *
 * Idempotent by construction: it asks Cloudinary what already exists and only
 * uploads the gaps. The first run moves ~1000 documents; every run after it is
 * a no-op that finishes in seconds. That is what makes "just run it again when
 * you add products" a reasonable operating procedure rather than a chore.
 *
 * Bytes are pulled and released one document at a time. A catalogue-wide run is
 * well over a gigabyte and must never be held in memory at once.
 *
 * Usage:
 *   node scripts/mirror-brochures.mjs --dry-run     # report, upload nothing
 *   node scripts/mirror-brochures.mjs               # mirror the catalogue
 *   node scripts/mirror-brochures.mjs --limit 5     # smoke test
 *
 * Credentials come from .env.mirror (git-ignored). See .env.mirror.example.
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { brochureExtension, brochurePublicId, brochureUrl } from "../src/lib/brochureUrl.js";

const run = promisify(execFile);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Odoo merges documents at these two visibilities into, or alongside, the
// quotation. Anything else is never part of a download and is not mirrored.
const MERGEABLE_VISIBILITY = ["inside", "quotation"];

// Enough to overlap the latency, few enough to stay a polite guest on Odoo
// Online — this is someone's live ERP, not a load test.
const CONCURRENCY = 4;

/** Odoo answers 429 under a sustained catalogue read; wait it out rather than lose the document. */
const MAX_RPC_ATTEMPTS = 6;

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const NO_COMPRESS = args.includes("--no-compress");
const LIMIT = (() => {
  const i = args.indexOf("--limit");
  return i >= 0 ? Number(args[i + 1]) : Infinity;
})();

// ── config ──────────────────────────────────────────────────────────────────

function loadEnv(file) {
  let raw;
  try {
    raw = readFileSync(resolve(ROOT, file), "utf8");
  } catch {
    console.error(
      `Missing ${file}. Copy .env.mirror.example to .env.mirror and fill it in.\n` +
        `The Odoo values are the same ones already set as Supabase function secrets.`,
    );
    process.exit(1);
  }
  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trimStart().startsWith("#") && line.includes("="))
      .map((line) => {
        const i = line.indexOf("=");
        return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
      }),
  );
}

const env = loadEnv(".env.mirror");

const REQUIRED = [
  "ODOO_URL",
  "ODOO_DB",
  "ODOO_USERNAME",
  "ODOO_API_KEY",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_UPLOAD_PRESET",
];
const missing = REQUIRED.filter((key) => !env[key]);
if (missing.length) {
  console.error(`.env.mirror is missing: ${missing.join(", ")}`);
  process.exit(1);
}

const CLOUD = { cloudName: env.CLOUDINARY_CLOUD_NAME, folder: env.CLOUDINARY_FOLDER || "" };

/**
 * Cloudinary rejects raw uploads above the plan's ceiling — 10 MB on the free
 * plan. Checked up front against the manifest's own file_size, so an oversized
 * document is reported as a decision to make rather than surfacing as a failure
 * after a pointless download.
 */
const MAX_UPLOAD_BYTES = Number(env.CLOUDINARY_MAX_BYTES || 10 * 1024 * 1024);

/**
 * Ghostscript preset for the documents that will not otherwise fit. /ebook is
 * 150 dpi — enough that a datasheet's fine print stays readable, which /screen
 * (72 dpi) would not be. These are documents customers have to actually read.
 */
const PDF_QUALITY = env.PDF_QUALITY || "/ebook";

/**
 * Compression happens here, on the way to Cloudinary, and never in Odoo.
 * Rewriting `datas` on the source record would be destructive and irreversible
 * if the result were too aggressive; this leaves the original untouched, so a
 * bad setting is fixed by changing PDF_QUALITY and running again. It also means
 * the URL still keys off Odoo's original checksum, so a revised datasheet
 * continues to invalidate itself.
 */
let ghostscriptBin;
async function resolveGhostscript() {
  if (ghostscriptBin !== undefined) return ghostscriptBin;
  for (const candidate of ["gswin64c", "gswin32c", "gs"]) {
    try {
      await run(candidate, ["--version"]);
      ghostscriptBin = candidate;
      return ghostscriptBin;
    } catch {
      // Try the next name — Windows and POSIX ship it under different ones.
    }
  }
  ghostscriptBin = null;
  return null;
}

const GHOSTSCRIPT_INSTALL_HINT = {
  win32: "winget install ArtifexSoftware.GhostScript, then reopen the shell",
  darwin: "brew install ghostscript",
  linux: "sudo apt-get install -y ghostscript",
}[process.platform] || "install Ghostscript for your platform";

async function compressPdf(bytes) {
  const bin = await resolveGhostscript();
  if (!bin) {
    throw new Error(
      `Ghostscript not found — ${GHOSTSCRIPT_INSTALL_HINT}, ` +
        "or pass --no-compress to skip oversized documents",
    );
  }

  const stem = join(tmpdir(), `brochure-${randomUUID()}`);
  const input = `${stem}-in.pdf`;
  const output = `${stem}-out.pdf`;
  try {
    writeFileSync(input, bytes);
    await run(bin, [
      "-sDEVICE=pdfwrite",
      "-dCompatibilityLevel=1.4",
      `-dPDFSETTINGS=${PDF_QUALITY}`,
      "-dNOPAUSE",
      "-dQUIET",
      "-dBATCH",
      `-sOutputFile=${output}`,
      input,
    ]);
    return await readFile(output);
  } finally {
    for (const path of [input, output]) rmSync(path, { force: true });
  }
}

// ── Odoo JSON-RPC ───────────────────────────────────────────────────────────
// Same shapes as supabase/functions/_shared/odoo.ts. Duplicated rather than
// imported because that file is Deno-flavoured and reads its config from
// Deno.env.

let rpcId = 0;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/**
 * Odoo Online rate-limits a sustained catalogue read and answers 429. That is a
 * "slow down", not a failure, so it is waited out rather than reported — the
 * first full run lost 109 documents to 429s that a backoff recovers for free.
 *
 * Jittered, because four workers throttled at the same instant would otherwise
 * retry in lockstep and trip the limit again together.
 */
async function odooCall(service, method, params, attempt = 0) {
  const res = await fetch(`${env.ODOO_URL.replace(/\/+$/, "")}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "call",
      params: { service, method, args: params },
      id: (rpcId += 1),
    }),
  });

  if ((res.status === 429 || res.status >= 500) && attempt < MAX_RPC_ATTEMPTS) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const backoff = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(2 ** attempt * 1000, 30000) + Math.random() * 1000;
    await sleep(backoff);
    return odooCall(service, method, params, attempt + 1);
  }

  if (!res.ok) throw new Error(`Odoo HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) {
    throw new Error(json.error.data?.message || json.error.message || "Odoo API error");
  }
  return json.result;
}

async function authenticate() {
  const uid = await odooCall("common", "authenticate", [
    env.ODOO_DB,
    env.ODOO_USERNAME,
    env.ODOO_API_KEY,
    {},
  ]);
  if (!uid) throw new Error("Odoo authentication failed — check ODOO_USERNAME / ODOO_API_KEY.");
  return uid;
}

const executeKw = (uid, model, method, params, kwargs = {}) =>
  odooCall("object", "execute_kw", [env.ODOO_DB, uid, env.ODOO_API_KEY, model, method, params, kwargs]);

// ── Cloudinary ──────────────────────────────────────────────────────────────

/** A miss is a clean 404 with no body, so this costs essentially nothing. */
async function existsOnCloudinary(doc) {
  const res = await fetch(brochureUrl(doc, CLOUD), { method: "HEAD" });
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  throw new Error(`Cloudinary returned ${res.status} checking ${brochureUrl(doc, CLOUD)}`);
}

/**
 * Proves the preset and CLOUDINARY_FOLDER agree with brochureUrl() *before* any
 * real work, by round-tripping a few bytes through the same code path.
 *
 * This runs every time rather than piggy-backing on the first real upload,
 * because a run where everything is already mirrored would otherwise verify
 * nothing at all and still report success — which is exactly how a preset
 * change could go unnoticed until a thousand files had gone to the wrong place.
 */
const PREFLIGHT_DOC = { id: "_preflight", checksum: "probe", name: "preflight.pdf" };

async function preflight() {
  const bytes = Buffer.from("%PDF-1.4\n% mirror-brochures preflight\n%%EOF\n", "utf8");
  await uploadToCloudinary(PREFLIGHT_DOC, bytes);

  const url = brochureUrl(PREFLIGHT_DOC, CLOUD);
  const res = await fetch(url, { method: "HEAD" });
  if (res.status !== 200) {
    throw new Error(
      `Preflight failed: uploaded a probe but it is not readable at\n  ${url}\nHTTP ${res.status}.\n` +
        `Either CLOUDINARY_FOLDER does not match what the preset prepends, or the preset is ` +
        `rewriting the public id — check that "Disallow public ID" is off.\n` +
        `Nothing else has been uploaded.`,
    );
  }
  console.log(`preflight ok — ${url}\n`);
}

async function uploadToCloudinary(doc, bytes) {
  const form = new FormData();
  // Cloudinary derives the delivery extension from the filename, so the
  // filename is synthesised from brochureExtension() rather than passed through
  // from Odoo. Some documents are named without any extension at all
  // ("GD-300 Power Platform pdf"), and handing that over verbatim stored them
  // with no extension while the app went looking for one — a 404 that would
  // have hard-refused every order containing them.
  form.append("file", new Blob([bytes]), `${doc.id}.${brochureExtension(doc)}`);
  form.append("upload_preset", env.CLOUDINARY_UPLOAD_PRESET);
  form.append("public_id", brochurePublicId(doc));

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${CLOUD.cloudName}/raw/upload`,
    { method: "POST", body: form },
  );
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.error) {
    throw new Error(json?.error?.message || `Cloudinary upload failed (HTTP ${res.status})`);
  }
  return json;
}

// ── the run ─────────────────────────────────────────────────────────────────

const mb = (n) => `${(n / (1024 * 1024)).toFixed(1)} MB`;

async function main() {
  console.log(DRY_RUN ? "DRY RUN — nothing will be uploaded\n" : "Mirroring brochures to Cloudinary\n");

  const uid = await authenticate();

  // Metadata only. Pulling `datas` for the whole catalogue in one call would be
  // well over a gigabyte of base64 in a single JSON response.
  const documents = await executeKw(
    uid,
    "product.document",
    "search_read",
    [
      [["attached_on", "in", MERGEABLE_VISIBILITY]],
      ["id", "name", "checksum", "write_date", "attached_on", "mimetype", "file_size"],
    ],
    { order: "id asc" },
  );

  const sizeOf = (docs) => docs.reduce((sum, d) => sum + (d.file_size || 0), 0);
  const queue = documents.slice(0, LIMIT === Infinity ? undefined : LIMIT);

  // Report the whole catalogue's size regardless of --limit: the number worth
  // knowing before a full run is what the full run will move, not what this
  // truncated one will.
  console.log(`${documents.length} mergeable document(s) in Odoo, ${mb(sizeOf(documents))} total`);
  if (queue.length !== documents.length) {
    console.log(`limited to ${queue.length} for this run (${mb(sizeOf(queue))})\n`);
  } else {
    console.log("");
  }

  if (!DRY_RUN) await preflight();

  const state = { skipped: 0, uploaded: 0, bytes: 0, failed: [], tooLarge: [], mismatched: [] };
  let done = 0;

  async function handle(doc) {
    const label = `${doc.id} ${doc.name || "(unnamed)"}`;
    try {
      if (await existsOnCloudinary(doc)) {
        state.skipped += 1;
        return;
      }

      // Oversized documents are only worth downloading if we can do something
      // about them; otherwise Cloudinary would refuse the upload anyway and the
      // 60 MB pull from Odoo is wasted.
      const oversize = (doc.file_size || 0) > MAX_UPLOAD_BYTES;
      const compressible = brochureExtension(doc) === "pdf";
      if (oversize && (NO_COMPRESS || !compressible)) {
        state.tooLarge.push({ doc: label, bytes: doc.file_size || 0 });
        return;
      }

      if (DRY_RUN) {
        state.uploaded += 1;
        state.bytes += doc.file_size || 0;
        console.log(`  would upload  ${mb(doc.file_size || 0).padStart(9)}  ${label}`);
        return;
      }

      const [full] = await executeKw(uid, "product.document", "read", [[doc.id], ["datas"]]);
      if (!full?.datas) throw new Error("no file content in Odoo");

      const bytes = Buffer.from(full.datas, "base64");
      let payload = bytes;

      // Only ever applied where the alternative is "cannot mirror at all".
      // Anything already under the ceiling uploads bit-for-bit untouched.
      if (payload.byteLength > MAX_UPLOAD_BYTES) {
        payload = await compressPdf(bytes);
        if (payload.byteLength > MAX_UPLOAD_BYTES) {
          state.tooLarge.push({
            doc: label,
            bytes: bytes.byteLength,
            compressed: payload.byteLength,
          });
          return;
        }
        console.log(
          `  compressed    ${mb(bytes.byteLength).padStart(9)} → ${mb(payload.byteLength)}  ${label}`,
        );
      }

      const result = await uploadToCloudinary(doc, payload);

      // Trust nothing about where Cloudinary decided to put it. The delivery
      // extension is derived from the upload in ways that are not worth
      // second-guessing, so compare what came back against the address the
      // browser will build and report any disagreement with both sides shown.
      const expected = brochureUrl(doc, CLOUD);
      const actual = String(result.secure_url || "").replace(/\/v\d+\//, "/");
      if (actual !== expected) {
        state.mismatched.push({ doc: label, expected, actual, publicId: result.public_id });
        console.log(`  MISPLACED                ${label}`);
        return;
      }

      state.uploaded += 1;
      state.bytes += payload.byteLength;
      console.log(`  uploaded      ${mb(payload.byteLength).padStart(9)}  ${label}`);
    } catch (err) {
      state.failed.push({ doc: label, message: err.message });
      console.log(`  FAILED                   ${label} — ${err.message}`);
    } finally {
      done += 1;
      if (done % 50 === 0) console.log(`  … ${done}/${queue.length}`);
    }
  }

  let next = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (next < queue.length) {
      await handle(queue[next++]);
    }
  });
  await Promise.all(workers);

  console.log("\n─────────────────────────────────────────");
  console.log(`already mirrored : ${state.skipped}`);
  console.log(`${DRY_RUN ? "would upload     " : "uploaded         "}: ${state.uploaded}  (${mb(state.bytes)})`);
  console.log(`too large        : ${state.tooLarge.length}`);
  console.log(`misplaced        : ${state.mismatched.length}`);
  console.log(`failed           : ${state.failed.length}`);

  if (state.mismatched.length) {
    console.log("\nUploaded, but Cloudinary stored them somewhere the app will not look:");
    for (const m of state.mismatched) {
      console.log(`   ${m.doc}`);
      console.log(`     app expects : ${m.expected}`);
      console.log(`     actually at : ${m.actual}`);
      console.log(`     public_id   : ${m.publicId}`);
    }
  }

  if (state.tooLarge.length) {
    console.log(
      `\nOver the ${mb(MAX_UPLOAD_BYTES)} upload ceiling — these can never mirror as-is:`,
    );
    for (const t of [...state.tooLarge].sort((a, b) => b.bytes - a.bytes)) {
      const after = t.compressed ? ` → ${mb(t.compressed)} compressed, still over` : "";
      console.log(`   ${mb(t.bytes).padStart(9)}${after}  ${t.doc}`);
    }
    console.log(
      `\nEach one blocks any quotation containing its product, because a missing\n` +
        `brochure hard-refuses the download. Try a harder PDF_QUALITY (/screen),\n` +
        `exclude them by setting attached_on to false, or raise the ceiling with a\n` +
        `paid Cloudinary plan.`,
    );
  }

  if (state.failed.length) {
    console.log("\nTransient failures:");
    for (const f of state.failed) console.log(`   ${f.doc} — ${f.message}`);
    console.error(
      `\n${state.failed.length} document(s) did not mirror. Re-running is safe — ` +
        `anything already uploaded is skipped.`,
    );
    process.exit(1);
  }

  if (state.tooLarge.length || state.mismatched.length) process.exit(2);
  console.log("\nDone. Zero Supabase egress used.");
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
