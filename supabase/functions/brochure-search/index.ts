// Searches the brochure library on Cloudinary by readable name (brand, model,
// document type) for the shared file picker (#760).
//
// The Cloudinary API secret lives only in this function's secrets
// (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET); the
// browser never sees it. Read-only: the Search API is the only call made.
// Deploy with the default JWT verification ON.
//
// Each brochure carries a readable `label` in its Cloudinary context, written
// by scripts/mirror-brochures.mjs alongside the fixed public id, so quotation
// downloads (which use the fixed id) are untouched.

import { corsHeaders, jsonResponse } from "../_shared/odoo.ts";

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 80;
const RESULT_LIMIT = 20;

/** Every word must appear somewhere in the label; characters Cloudinary treats as syntax are dropped. */
export function buildExpression(query: string): string {
  const words = query
    .replace(/[^\p{L}\p{N}.-]+/gu, " ")
    .split(" ")
    .filter(Boolean)
    .slice(0, 6);
  const terms = words.map((word) => `context.label:*${word}*`);
  return ["resource_type:raw", ...terms].join(" AND ");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const cloud = Deno.env.get("CLOUDINARY_CLOUD_NAME");
  const key = Deno.env.get("CLOUDINARY_API_KEY");
  const secret = Deno.env.get("CLOUDINARY_API_SECRET");
  if (!cloud || !key || !secret) {
    return jsonResponse({ success: false, message: "Brochure search is not configured on the server." });
  }

  let query: unknown;
  try {
    ({ query } = await req.json());
  } catch {
    return jsonResponse({ success: false, message: "Invalid request body." });
  }

  const text = String(query ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  if (text.length < MIN_QUERY_LENGTH) return jsonResponse({ success: true, brochures: [] });

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/resources/search`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${btoa(`${key}:${secret}`)}`,
    },
    body: JSON.stringify({
      expression: buildExpression(text),
      max_results: RESULT_LIMIT,
      with_field: ["context"],
    }),
  });
  if (!res.ok) {
    return jsonResponse({ success: false, message: `Brochure search failed (HTTP ${res.status}).` });
  }

  const json = await res.json();
  const brochures = (json.resources ?? [])
    .filter((r: { context?: { custom?: { label?: string } } }) => r.context?.custom?.label)
    .map((r: { secure_url: string; format?: string; bytes?: number; context: { custom: { label: string } } }) => ({
      url: String(r.secure_url).replace(/\/v\d+\//, "/"),
      label: r.context.custom.label,
      format: r.format || "pdf",
      bytes: r.bytes || 0,
    }));

  return jsonResponse({ success: true, brochures });
});
