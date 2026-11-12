import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { setupUser } from "@/test/support";
import FilterBar from "./FilterBar";
import { FilterSelect } from "./FilterDropdown";

// A chip shows its chosen option's label: "<label> any" when unset, "<label> set" when set.
const chip = (label, value) => (
  <FilterSelect
    label={label}
    options={[{ value: "ALL", label: `${label} any` }, { value: "A", label: `${label} set` }]}
    value={value}
    onChange={() => {}}
  />
);

/** Make exactly the queries in `matching` (substring match) report a match. */
function stubMedia(...matching) {
  window.matchMedia = (query) => ({
    matches: matching.some((m) => query.includes(m)),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
}

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

  it("draws Save as default icon-only so the row fits, keeping its name for screen readers", () => {
    render(<FilterBar search={{ value: "", onChange: () => {} }} saveDefault={saveDefault} />);

    const save = screen.getByRole("button", { name: "Save filters as default" });
    expect(save).toHaveAttribute("title");
    expect(screen.getByText("Save filters as default")).toHaveClass("sr-only");
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

describe("FilterBar (phones and the laptop band)", () => {
  afterEach(() => stubMedia());

  it("on phones keeps search and one Filters (n) button; chips live in the bottom sheet and count", async () => {
    stubMedia("max-width: 767.98px");
    const user = setupUser();
    const onClearAll = vi.fn();
    render(
      <FilterBar
        search={{ value: "", onChange: () => {}, placeholder: "Search" }}
        chips={<>{chip("Status", "A")}{chip("Owner", "ALL")}</>}
        filters={<div>popover body</div>}
        activeCount={1}
        hasActiveFilters
        onClearAll={onClearAll}
        saveDefault={saveDefault}
      />,
    );
    expect(screen.queryByRole("button", { name: "Three set" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: /^Filters/ });
    expect(button).toHaveTextContent("2");

    await user.click(button);
    expect(screen.getByText("Status set")).toBeInTheDocument();
    expect(screen.getByText("popover body")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(onClearAll).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save filters as default" })).toBeInTheDocument();
  });

  it("in the laptop band shows two chips inline and folds the rest into Filters", async () => {
    stubMedia("min-width: 1024px");
    const user = setupUser();
    render(
      <FilterBar
        chips={<>{chip("One", "ALL")}{chip("Two", "ALL")}{chip("Three", "A")}</>}
      />,
    );
    expect(screen.getByRole("button", { name: "One any" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Two any" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Three set" })).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: /^Filters/ });
    expect(button).toHaveTextContent("1");
    await user.click(button);
    expect(screen.getByRole("button", { name: "Three set" })).toBeInTheDocument();
  });

  it("honours inlineChips", () => {
    render(<FilterBar inlineChips={1} chips={<>{chip("One", "ALL")}{chip("Two", "ALL")}</>} />);
    expect(screen.getByRole("button", { name: "One any" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Two any" })).not.toBeInTheDocument();
  });
});
