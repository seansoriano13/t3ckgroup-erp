import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { setupUser } from "@/test/support";
import FilterBar from "./FilterBar";

const saveDefault = { hasSavedDefault: false, isDirty: false, onSave: vi.fn(), onClear: vi.fn() };

describe("FilterBar (one line)", () => {
  it("renders search, chips, the Filters button and Save as default on one row", () => {
    render(
      <FilterBar
        search={{ value: "", onChange: () => {}, placeholder: "Search tasks" }}
        chips={<button type="button">Status chip</button>}
        filters={() => <div>popover body</div>}
        saveDefault={saveDefault}
      />,
    );

    expect(screen.getByRole("textbox", { name: "Search tasks" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Status chip" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save filters as default" })).toBeInTheDocument();
    // Folded away until the button is pressed.
    expect(screen.queryByText("popover body")).not.toBeInTheDocument();
  });

  it("shows the active count on the Filters button and opens the popover on click", async () => {
    const user = setupUser();
    render(
      <FilterBar
        search={{ value: "", onChange: () => {} }}
        filters={() => <div>popover body</div>}
        activeCount={2}
      />,
    );

    const button = screen.getByRole("button", { name: /^Filters/ });
    expect(button).toHaveTextContent("2");

    await user.click(button);
    expect(screen.getByText("popover body")).toBeInTheDocument();
  });

  it("omits the Filters button when the page has no folded filters", () => {
    render(<FilterBar search={{ value: "", onChange: () => {} }} />);
    expect(screen.queryByRole("button", { name: /^Filters/ })).not.toBeInTheDocument();
  });

  it("reports typing through search.onChange and offers Clear only when something is active", async () => {
    const user = setupUser();
    const onChange = vi.fn();
    const onClearAll = vi.fn();
    const { rerender } = render(
      <FilterBar search={{ value: "", onChange, placeholder: "Search" }} onClearAll={onClearAll} />,
    );
    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Search" }), "a");
    expect(onChange).toHaveBeenCalledWith("a");

    rerender(
      <FilterBar
        search={{ value: "a", onChange, placeholder: "Search" }}
        hasActiveFilters
        onClearAll={onClearAll}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onClearAll).toHaveBeenCalled();
  });
});
