import { describe, expect, it } from "vitest";
import { brochureLibraryService, brochureToAttachment } from "./brochureLibraryService";
import { stubEdgeFunction } from "@/test/msw/server";

describe("brochureLibraryService", () => {
  it("returns the brochures the faked Cloudinary search found", async () => {
    let received;
    stubEdgeFunction("brochure-search", (body) => {
      received = body;
      return {
        success: true,
        brochures: [
          { url: "https://res.cloudinary.com/x/raw/upload/brochures/1-a.pdf", label: "Delta - GD-300 - Datasheet", format: "pdf", bytes: 10 },
        ],
      };
    });
    const found = await brochureLibraryService.search("  delta ");
    expect(received).toEqual({ query: "delta" });
    expect(found).toHaveLength(1);
    expect(found[0].label).toBe("Delta - GD-300 - Datasheet");
  });

  it("does not call the server for a too-short query", async () => {
    expect(await brochureLibraryService.search("d")).toEqual([]);
  });

  it("surfaces a server-side failure", async () => {
    stubEdgeFunction("brochure-search", { success: false, message: "Cloudinary is not configured." });
    await expect(brochureLibraryService.search("delta")).rejects.toThrow("not configured");
  });

  it("turns a pick into a linked attachment", () => {
    expect(
      brochureToAttachment({ url: "u", label: "Delta - GD-300 - Datasheet", format: "pdf", bytes: 5 }),
    ).toEqual({ url: "u", name: "Delta - GD-300 - Datasheet.pdf", type: "application/pdf", bytes: 5, linked: true });
  });
});
