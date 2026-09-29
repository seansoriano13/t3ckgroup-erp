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
