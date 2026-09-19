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
});
