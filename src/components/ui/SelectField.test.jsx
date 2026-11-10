import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import { setupUser } from "@/test/support";
import Dropdown from "./Dropdown";
import { SelectField } from "./SelectField";

const OPTIONS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma", disabled: true },
];

describe("SelectField", () => {
  it("shows the placeholder until a value is set", () => {
    render(<SelectField options={OPTIONS} placeholder="Pick one" />);
    expect(screen.getByRole("combobox")).toHaveTextContent("Pick one");
  });

  it("treats an empty-string value as nothing chosen unless an option is \"\"", () => {
    const { rerender } = render(<SelectField options={OPTIONS} value="" placeholder="Pick one" />);
    expect(screen.getByRole("combobox")).toHaveTextContent("Pick one");
    rerender(<SelectField options={[{ value: "", label: "None" }, ...OPTIONS]} value="" placeholder="Pick one" />);
    expect(screen.getByRole("combobox")).toHaveTextContent("None");
  });

  it("chooses an option", async () => {
    const user = setupUser();
    const onChange = vi.fn();
    render(<SelectField options={OPTIONS} onChange={onChange} placeholder="Pick" />);
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Beta" }));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("navigates and selects by keyboard", async () => {
    const user = setupUser();
    const onChange = vi.fn();
    render(<SelectField options={OPTIONS} onChange={onChange} placeholder="Pick" />);
    screen.getByRole("combobox").focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("option", { name: "Alpha" });
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("does not open when disabled", async () => {
    const user = setupUser();
    render(<SelectField options={OPTIONS} disabled placeholder="Pick" />);
    await user.click(screen.getByRole("combobox"));
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
  });

  it("follows the controlled value", async () => {
    const user = setupUser();
    const Controlled = () => {
      const [v, setV] = useState("a");
      return <SelectField options={OPTIONS} value={v} onChange={setV} />;
    };
    render(<Controlled />);
    expect(screen.getByRole("combobox")).toHaveTextContent("Alpha");
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Beta" }));
    expect(screen.getByRole("combobox")).toHaveTextContent("Beta");
  });

  it("picks inside a Dropdown popover without closing the outer one", async () => {
    const user = setupUser();
    const onChange = vi.fn();
    render(
      <Dropdown usePortal trigger={<button>Filters</button>}>
        {() => (
          <div>
            <p>Outer Panel</p>
            <SelectField options={OPTIONS} onChange={onChange} placeholder="Pick" />
          </div>
        )}
      </Dropdown>,
    );
    await user.click(screen.getByRole("button", { name: "Filters" }));
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Beta" }));
    expect(onChange).toHaveBeenCalledWith("b");
    expect(screen.getByText("Outer Panel")).toBeInTheDocument();
  });
});

// #870: a select is a full form control — reachable by Tab, opened and
// driven from the keyboard, announced to assistive tech, and able to stop a
// form that needs it.
describe("SelectField: keyboard and form behaviour (#870)", () => {
  it("is reached with Tab and opens with Space, then picks with the arrows and Enter", async () => {
    const user = setupUser();
    const onChange = vi.fn();
    render(
      <>
        <button type="button">Before</button>
        <SelectField label="Fruit" options={OPTIONS} onChange={onChange} placeholder="Pick" />
      </>,
    );
    await user.tab();
    await user.tab();
    const trigger = screen.getByRole("combobox", { name: "Fruit" });
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.keyboard(" ");
    await screen.findByRole("option", { name: "Alpha" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    // Base UI ignores keys for a moment after opening, so the key that opened
    // the list cannot also pick from it. A person never types that fast.
    await new Promise((r) => setTimeout(r, 50));
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("stops a form from submitting while a required one is blank, and says so", async () => {
    const user = setupUser();
    const onSubmit = vi.fn((e) => e.preventDefault());
    const Form = () => {
      const [v, setV] = useState("");
      return (
        <form onSubmit={onSubmit}>
          <SelectField label="Fruit" required options={OPTIONS} value={v} onChange={setV} placeholder="Pick" />
          <button type="submit">Save</button>
        </form>
      );
    };
    render(<Form />);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).not.toHaveBeenCalled();
    const trigger = screen.getByRole("combobox", { name: "Fruit" });
    expect(trigger).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Choose an option.")).toBeInTheDocument();

    await user.click(trigger);
    await user.click(await screen.findByRole("option", { name: "Beta" }));
    expect(screen.queryByText("Choose an option.")).not.toBeInTheDocument();
    expect(trigger).not.toHaveAttribute("aria-invalid", "true");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("shows the blank-required message without a label too", async () => {
    const user = setupUser();
    const onSubmit = vi.fn((e) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <SelectField aria-label="Fruit" required options={OPTIONS} value="" placeholder="Pick" />
        <button type="submit">Save</button>
      </form>,
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: "Fruit" })).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Choose an option.")).toBeInTheDocument();
  });
});
