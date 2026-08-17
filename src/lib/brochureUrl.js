/**
 * The single definition of a brochure's identity on Cloudinary.
 *
 * Two very different programs derive this: the mirror script that uploads the
 * file (scripts/mirror-brochures.mjs, run locally against Odoo) and the
 * download path that fetches it (quotationService, running in the browser).
 * There is no lookup table between them — the URL *is* the agreement. If the
 * two ever computed it differently, every download would hard-refuse, so the
 * rule lives here and is imported by both rather than written twice.
 *
 * Deliberately dependency-free and free of Vite-isms, because the script runs
 * under plain Node with no bundler.
 */

/**
 * Cloudinary public ids tolerate a narrow character set, and `write_date`
 * carries spaces and colons. Anything outside the safe set collapses to a dash.
 */
function slug(value) {
  return String(value).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * What makes one version of a brochure different from the next. Mirrors the
 * key the browser cache already used, so a datasheet revised in Odoo becomes a
 * new name and invalidates itself with no purge step.
 */
export function brochureVersion(doc) {
  return slug(doc.checksum || doc.write_date || "unversioned");
}

/**
 * Cloudinary keeps the uploaded file's extension on the delivery URL, so the
 * URL has to carry it too. Taken from the document name rather than assumed to
 * be PDF: a non-PDF attachment should resolve, be fetched, and then fail to
 * merge as an ordinary skipped-brochure warning — not 404 and block the whole
 * download.
 */
export function brochureExtension(doc) {
  // Requires the extension to start with a letter, so a document called
  // "Spec v1.2" is not read as having the extension "2".
  const fromName = /\.([A-Za-z][A-Za-z0-9]{0,7})$/.exec(doc.name || "");
  if (fromName) return fromName[1].toLowerCase();

  // Odoo holds real brochures named with no extension at all — and at least one
  // of them ("DELTA Gasoline Inverter Generator") is a PNG rather than a PDF.
  // The mimetype is the only honest source left before guessing.
  const subtype = /^[A-Za-z]+\/([A-Za-z0-9.+-]+)$/.exec(doc.mimetype || "");
  if (subtype) {
    const format = subtype[1].toLowerCase();
    return format === "jpeg" ? "jpg" : format;
  }

  return "pdf";
}

/**
 * The id requested at upload time, before Cloudinary prefixes the preset folder.
 *
 * The extension is part of the id rather than left for Cloudinary to append,
 * because it only appends one when the uploaded *filename* carries one — a
 * document named "GD-300 Power Platform pdf" (no dot) was stored with no
 * extension while the app went looking for `.pdf`, and 404'd. Supplying it here
 * is used verbatim and is not doubled up, so the address stops depending on
 * anything Cloudinary infers.
 */
export function brochurePublicId(doc) {
  return `brochures/${doc.id}-${brochureVersion(doc)}.${brochureExtension(doc)}`;
}

/**
 * The delivery URL. `folder` is whatever folder the upload preset is configured
 * to write into — Cloudinary prepends it to the requested public id, so it has
 * to be repeated here. The version segment Cloudinary returns is omitted
 * deliberately: version-less URLs resolve, and leaving it out means nothing has
 * to be stored between upload and download.
 */
export function brochureUrl(doc, { cloudName, folder = "" }) {
  const prefix = folder ? `${folder.replace(/^\/+|\/+$/g, "")}/` : "";
  return `https://res.cloudinary.com/${cloudName}/raw/upload/${prefix}${brochurePublicId(doc)}`;
}
