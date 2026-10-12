import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";
import CrmFormula from "../../pages/crm/commission-formula/index";
import OppFormula from "../../pages/opportunities/commission-formula/index";
import SuperAdmin from "../../pages/super-admin/index";
import LeadSources from "../../pages/super-admin/lead-sources/index";
import NotFound from "../../pages/404";

function Where() {
  const l = useLocation();
  return <div data-testid="loc">{l.pathname + l.search}</div>;
}
function at(url, path, El) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path={path} element={<El />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  return screen.getByTestId("loc").textContent;
}

describe("redirects", () => {
  it("crm formula keeps params", () => {
    const loc = at("/crm/commission-formula?record=abc&year=2026", "/crm/commission-formula", CrmFormula);
    expect(loc).toContain("/sors/commission");
    expect(loc).toContain("tab=formula");
    expect(loc).toContain("record=abc");
    expect(loc).toContain("year=2026");
  });
  it("opportunities formula keeps params", () => {
    const loc = at("/opportunities/commission-formula?record=abc", "/opportunities/commission-formula", OppFormula);
    expect(loc).toContain("tab=formula");
    expect(loc).toContain("record=abc");
  });
  it("super-admin lands on tabs", () => {
    expect(at("/super-admin", "/super-admin", SuperAdmin)).toBe("/settings?tab=announcements");
  });
  it("lead-sources lands on sales", () => {
    expect(at("/super-admin/lead-sources", "/super-admin/lead-sources", LeadSources)).toBe("/settings?tab=sales");
  });
  it("renders not-found", () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading").textContent.replace(/ /g, "")).toBe("Pagenotfound");
    expect(screen.getByRole("link", { name: "Back to dashboard" })).toBeTruthy();
  });
});
