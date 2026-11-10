import { describe, it, expect } from "vitest";
import { buildXlsx } from "./xlsx";

const text = (bytes) => new TextDecoder().decode(bytes);

describe("buildXlsx", () => {
  const bytes = buildXlsx({
    sheetName: "IPAS",
    header: ["IPAS No.", "Amount"],
    rows: [
      ["TGIPAS_049", { value: 1234.5, format: '"₱"#,##0.00' }],
      ["TGIPAS_050 <&>", null],
    ],
  });

  it("is a zip holding the workbook parts", () => {
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const all = text(bytes);
    for (const name of ["[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/styles.xml"]) {
      expect(all).toContain(name);
    }
  });

  it("writes the header first, numbers as numbers, and escapes text", () => {
    const all = text(bytes);
    expect(all.indexOf("IPAS No.")).toBeLessThan(all.indexOf("TGIPAS_049"));
    expect(all).toContain("<v>1234.5</v>");
    expect(all).toContain("TGIPAS_050 &lt;&amp;&gt;");
    expect(all).toContain("&quot;₱&quot;#,##0.00");
  });
});
