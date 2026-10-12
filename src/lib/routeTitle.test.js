import { describe, it, expect } from "vitest";
import { routeTitle } from "./routeTitle";

describe("routeTitle", () => {
  it("titles routes distinctly", () => {
    expect(routeTitle("/bug-reports")).toContain("Bug Reports · T3CKGROUP ERP");
    expect(routeTitle("/sors/commission")).toContain("Commission");
    expect(routeTitle("/nope")).toContain("Page not found");
    expect(routeTitle("/")).toContain("Dashboard");
  });
});
