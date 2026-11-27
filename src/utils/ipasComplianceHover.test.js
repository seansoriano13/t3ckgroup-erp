import { describe, expect, it } from "vitest";

import { doneTooltipText } from "./ipasComplianceHover";

describe("doneTooltipText", () => {
  it("says the day and the note, or the day alone", () => {
    const kind = { doneOn: "2020-11-02", note: "ECC no. 5" };
    expect(doneTooltipText(kind)).toBe("Done Nov 2, 2020 · ECC no. 5");
    expect(doneTooltipText(kind, { withNote: false })).toBe("Done Nov 2, 2020");
  });
});
