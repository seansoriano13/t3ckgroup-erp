import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import TabGroup from "./TabGroup";
import { Users, FileSpreadsheet } from "lucide-react";

describe("TabGroup", () => {
  it("renders tabs as non-submitting buttons with correct active state", () => {
    const handleChange = vi.fn();
    const tabs = [
      { value: "tab-1", label: "Sales Roster", icon: Users },
      { value: "tab-2", label: "Transaction Ledger", icon: FileSpreadsheet, badge: 5 },
    ];

    render(
      <TabGroup
        tabs={tabs}
        activeTab="tab-1"
        onChange={handleChange}
        variant="pill"
      />,
    );

    const buttons = screen.getAllByRole("tab");
    expect(buttons).toHaveLength(2);

    // Ensure buttons have type="button" to prevent unwanted form submit or scroll resets
    expect(buttons[0]).toHaveAttribute("type", "button");
    expect(buttons[1]).toHaveAttribute("type", "button");

    expect(screen.getByText("Sales Roster")).toBeInTheDocument();
    expect(screen.getByText("Transaction Ledger")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();

    fireEvent.click(buttons[1]);
    expect(handleChange).toHaveBeenCalledWith("tab-2");
  });

  it("handles string tabs properly", () => {
    const handleChange = vi.fn();
    render(
      <TabGroup
        tabs={["Overview", "Details", "Settings"]}
        activeTab="Overview"
        onChange={handleChange}
      />,
    );

    const detailsTab = screen.getByRole("tab", { name: "Details" });
    fireEvent.click(detailsTab);
    expect(handleChange).toHaveBeenCalledWith("Details");
  });

  it("fades only the clipped edge and scrolls the active tab into view", () => {
    const tabs = ["One", "Two", "Three", "Four"];
    const spies = [
      vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100),
      vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(400),
      vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(80),
    ];
    const { rerender } = render(
      <TabGroup tabs={tabs} activeTab="One" onChange={() => {}} />,
    );
    const list = screen.getByRole("tablist");
    expect(list).toHaveAttribute("data-fade-right", "true");
    expect(list).not.toHaveAttribute("data-fade-left");
    // jsdom has no layout, so scrollLeft would silently clamp to 0.
    let left = 0;
    Object.defineProperty(list, "scrollLeft", {
      get: () => left,
      set: (v) => {
        left = v;
      },
      configurable: true,
    });
    Object.defineProperty(screen.getByRole("tab", { name: "Four" }), "offsetLeft", {
      value: 300,
    });
    rerender(<TabGroup tabs={tabs} activeTab="Four" onChange={() => {}} />);
    expect(list.scrollLeft).toBeGreaterThan(0);
    spies.forEach((s) => s.mockRestore());
  });
});

describe("TabGroup on phones", () => {
  const five = ["General", "Pay", "Docs", "Team", "Notes"];
  const stub = (matches) => {
    window.matchMedia = (query) => ({
      matches, media: query, addEventListener: () => {}, removeEventListener: () => {},
    });
  };

  it("turns an underline group with more than four tabs into a Select", () => {
    stub(true);
    render(<TabGroup tabs={five} activeTab="Pay" onChange={() => {}} variant="underline" />);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    stub(false);
  });

  it("keeps pills and short underline groups as tabs", () => {
    stub(true);
    const { rerender } = render(<TabGroup tabs={five} activeTab="Pay" onChange={() => {}} />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    rerender(<TabGroup tabs={five.slice(0, 4)} activeTab="Pay" onChange={() => {}} variant="underline" />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    stub(false);
  });
});
