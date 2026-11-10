import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import { setupUser } from "@/test/support";
import { SelectField, SorFieldGroup } from "./SorField";

const OPTIONS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
];

// #870: the SOR form's select was a clickable div — no Tab stop, no keyboard,
// no name for screen readers, and "required" was only a red star.
describe("SorField SelectField", () => {
  it("is a named combobox reached with Tab and driven by the keyboard", async () => {
    const user = setupUser();
    const onChange = vi.fn();
    render(<SelectField label="Lead Source" required options={OPTIONS} value="" onChange={onChange} />);
    await user.tab();
    const trigger = screen.getByRole("combobox", { name: /Lead Source/ });
    expect(trigger).toHaveFocus();
    await user.keyboard("{Enter}");
    await screen.findByRole("option", { name: "Alpha" });
    // Base UI ignores keys for a moment after opening (see SelectField.test).
    await new Promise((r) => setTimeout(r, 50));
    await user.keyboard("{ArrowDown}{Enter}");
    // Same event shape as a text input, so the form's set(key) handler works.
    expect(onChange).toHaveBeenCalledWith({ target: { value: "b" } });
  });

  it("stops the form when required and blank, and says so", async () => {
    const user = setupUser();
    const onSubmit = vi.fn((e) => e.preventDefault());
    const Form = () => {
      const [v, setV] = useState("");
      return (
        <form onSubmit={onSubmit}>
          <SelectField label="Deal Owner" required options={OPTIONS} value={v} onChange={(e) => setV(e.target.value)} />
          <button type="submit">Save</button>
        </form>
      );
    };
    render(<Form />);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: /Deal Owner/ })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Choose an option.")).toBeInTheDocument();
  });

  it("offers the placeholder as a way to clear an optional field", async () => {
    const user = setupUser();
    const onChange = vi.fn();
    render(<SelectField label="Support Sales 1" options={OPTIONS} value="a" onChange={onChange} placeholder="None" />);
    await user.click(screen.getByRole("combobox", { name: /Support Sales 1/ }));
    await user.click(await screen.findByRole("option", { name: "None" }));
    expect(onChange).toHaveBeenCalledWith({ target: { value: "" } });
  });

  it("drops its own card inside a field group (#871)", () => {
    render(
      <>
        <SelectField label="Alone" options={OPTIONS} />
        <SorFieldGroup label="Details">
          <SelectField label="Grouped" options={OPTIONS} />
        </SorFieldGroup>
      </>,
    );
    expect(screen.getByRole("group", { name: "Details" })).toBeInTheDocument();
    const shell = (name) => screen.getByRole("combobox", { name }).closest("[data-sor-field]");
    expect(shell("Alone")).toHaveAttribute("data-sor-field", "card");
    expect(shell("Grouped")).toHaveAttribute("data-sor-field", "grouped");
  });
});
