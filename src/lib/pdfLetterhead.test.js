import { describe, expect, it } from "vitest";
import { PDFArray, PDFDocument, PDFName, PDFRawStream, StandardFonts } from "pdf-lib";
import { ODOO_LETTERHEAD_COMPANY_NAME, replaceLetterheadText, resolveStoreLetterhead } from "./pdfLetterhead";

describe("resolveStoreLetterhead", () => {
  it("derives the letterhead from a store account's email", () => {
    expect(resolveStoreLetterhead("storecdoopc@gmail.com")).toBe("STORE CDO");
    expect(resolveStoreLetterhead("storetagbilaranopc@gmail.com")).toBe("STORE TAGBILARAN");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(resolveStoreLetterhead("  StoreCdoOPC@GMAIL.com  ")).toBe("STORE CDO");
  });

  it("leaves head-office and unrelated accounts alone", () => {
    expect(resolveStoreLetterhead("sales@t3ckgroup.com")).toBeNull();
    // No "opc" suffix — must not fire on every email that merely starts with "store".
    expect(resolveStoreLetterhead("storekeeper@gmail.com")).toBeNull();
    expect(resolveStoreLetterhead(undefined)).toBeNull();
    expect(resolveStoreLetterhead("")).toBeNull();
  });
});

/**
 * Reads a page's content back out as plain text, independent of
 * pdfLetterhead's own decoding, so the test is not just checking the module
 * against itself. pdf-lib can split one page's content across several stream
 * objects (a `Contents` array, one per draw call) — every part is decoded
 * and joined, the same way patchPageText itself reads them.
 */
async function rawContentTextOf(doc, pageIndex = 0) {
  const page = doc.getPages()[pageIndex];
  const ctx = page.node.context;
  const contents = ctx.lookup(page.node.get(PDFName.of("Contents")));
  const parts = contents instanceof PDFArray ? contents.asArray().map((r) => ctx.lookup(r)) : [contents];

  const texts = await Promise.all(
    parts.map(async (part) => {
      const bytes = part instanceof PDFRawStream ? part.contents : part.getContents();
      const isFlate = String(part.dict.get(PDFName.of("Filter"))).includes("Flate");
      const plain = isFlate
        ? new Uint8Array(
            await new Response(
              new Response(bytes).body.pipeThrough(new DecompressionStream("deflate")),
            ).arrayBuffer(),
          )
        : bytes;
      return new TextDecoder("latin1").decode(plain);
    }),
  );
  return texts.join("\n");
}

/**
 * pdf-lib always hex-encodes drawn text (`<53544F52...> Tj`, never a literal
 * `(...)`), so a plain substring check against the raw content never matches
 * human-readable text — this decodes those hex-string operators back to
 * characters. Deliberately simpler than pdfLetterhead's own decoder (no
 * ToUnicode/CID handling, since these fixtures never need it): an
 * independent check, not the module verifying itself.
 */
function decodedTextOf(rawContent) {
  return [...rawContent.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)]
    .map(([, hex]) => hex.match(/../g).map((byte) => String.fromCharCode(parseInt(byte, 16))).join(""))
    .join("");
}

describe("replaceLetterheadText", () => {
  // Saved and reloaded, not left as the freshly-created document: real usage
  // always patches a document that came from PDFDocument.load() (Odoo's
  // bytes over the wire), never one still being built in memory, and pdf-lib
  // does not fully resolve a page's Font resources until that round trip.
  const buildDoc = async (headerText) => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595, 842]);
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    page.drawText(headerText, { x: 29.6, y: 799.6, size: 10.25, font });
    page.drawText("8 Lt. Amb F. Neri St.", { x: 29.6, y: 784.3, size: 10.25, font });
    return PDFDocument.load(await doc.save());
  };

  it("removes the old name and draws the new one", async () => {
    const doc = await buildDoc(ODOO_LETTERHEAD_COMPANY_NAME);

    const replaced = await replaceLetterheadText(doc, doc.getPages(), { to: "STORE CDO" });

    expect(replaced).toBe(1);
    const text = decodedTextOf(await rawContentTextOf(doc));
    expect(text).not.toContain(ODOO_LETTERHEAD_COMPANY_NAME);
    expect(text).toContain("STORE CDO");
  });

  it("leaves unrelated text on the same page untouched", async () => {
    const doc = await buildDoc(ODOO_LETTERHEAD_COMPANY_NAME);

    await replaceLetterheadText(doc, doc.getPages(), { to: "STORE TAGBILARAN" });

    expect(decodedTextOf(await rawContentTextOf(doc))).toContain("8 Lt. Amb F. Neri St.");
  });

  it("is a no-op when the header text is not on the page", async () => {
    const doc = await buildDoc("Some Other Company");

    const replaced = await replaceLetterheadText(doc, doc.getPages(), { to: "STORE CDO" });

    expect(replaced).toBe(0);
    expect(decodedTextOf(await rawContentTextOf(doc))).not.toContain("STORE CDO");
  });

  it("only draws the replacement on pages where a match was found", async () => {
    const withHeader = await buildDoc(ODOO_LETTERHEAD_COMPANY_NAME);
    const withoutHeader = await buildDoc("Brochure Cover Page");
    const target = await PDFDocument.create();
    const [pageA] = await target.copyPages(withHeader, [0]);
    const [pageB] = await target.copyPages(withoutHeader, [0]);
    target.addPage(pageA);
    target.addPage(pageB);

    const replaced = await replaceLetterheadText(target, [pageA, pageB], { to: "STORE CDO" });

    expect(replaced).toBe(1);
    expect(decodedTextOf(await rawContentTextOf(target, 0))).toContain("STORE CDO");
    expect(decodedTextOf(await rawContentTextOf(target, 1))).not.toContain("STORE CDO");
  });

  it("requires a replacement name", async () => {
    const doc = await buildDoc(ODOO_LETTERHEAD_COMPANY_NAME);
    await expect(replaceLetterheadText(doc, doc.getPages(), {})).rejects.toThrow(/requires "to"/);
  });
});
