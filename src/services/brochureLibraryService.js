import { supabase } from "../lib/supabase";

const MIN_QUERY_LENGTH = 2;

const MIME_BY_EXTENSION = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** What a picked brochure looks like once attached: a linked file, never an upload. */
export function brochureToAttachment(brochure) {
  const extension = String(brochure.format || "pdf").toLowerCase();
  return {
    url: brochure.url,
    name: `${brochure.label}.${extension}`,
    type: MIME_BY_EXTENSION[extension] || "application/octet-stream",
    bytes: brochure.bytes || 0,
    linked: true,
  };
}

export const brochureLibraryService = {
  /**
   * Searches the brochure library by brand, model or document type. The
   * Cloudinary API secret lives in the brochure-search edge function; this only
   * ever sees the readable results. A query too short to mean anything returns
   * nothing without calling the server.
   */
  async search(query) {
    const text = String(query ?? "").trim();
    if (text.length < MIN_QUERY_LENGTH) return [];
    const { data, error } = await supabase.functions.invoke("brochure-search", {
      body: { query: text },
    });
    if (error) throw new Error(error.message || "Brochure search failed.");
    if (!data?.success) throw new Error(data?.message || "Brochure search failed.");
    return data.brochures ?? [];
  },
};
