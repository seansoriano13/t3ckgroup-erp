import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import ChoiceOptionsEditor from "./ChoiceOptionsEditor";
import { cleanChoiceOptions, choiceOptionsError } from "./choiceOptions";

function Harness({ initial = [] }) {
  const [rows, setRows] = useState(initial);
  return (
    <>
      <ChoiceOptionsEditor options={rows} onChange={setRows} />
      <output data-testid="rows">{JSON.stringify(rows)}</output>
    </>
  );
}

const rows = () => JSON.parse(screen.getByTestId("rows").textContent);

describe("ChoiceOptionsEditor", () => {
  it("adds, edits and removes option rows", () => {
    render(<Harness initial={["Yes"]} />);
    fireEvent.click(screen.getByRole("button", { name: /add option/i }));
    fireEvent.change(screen.getByLabelText("Option 2"), { target: { value: "No" } });
    expect(rows()).toEqual(["Yes", "No"]);

    fireEvent.click(screen.getByRole("button", { name: "Remove option 1" }));
    expect(rows()).toEqual(["No"]);
  });

  it("Enter in a row adds a new row instead of submitting", () => {
    render(<Harness initial={["Yes"]} />);
    fireEvent.keyDown(screen.getByLabelText("Option 1"), { key: "Enter" });
    expect(rows()).toEqual(["Yes", ""]);
    expect(screen.getByLabelText("Option 2")).toHaveFocus();
  });

  it("flags a duplicate inline", () => {
    render(<Harness initial={["Yes", "yes "]} />);
    expect(screen.getByText(/duplicate/i)).toBeInTheDocument();
  });
});

describe("choice option helpers", () => {
  it("trims and drops blank rows", () => {
    expect(cleanChoiceOptions([" Yes ", "", "  ", "No"])).toEqual(["Yes", "No"]);
  });

  it("needs at least two options and no duplicates", () => {
    expect(choiceOptionsError(["Yes", ""])).toMatch(/at least 2/i);
    expect(choiceOptionsError(["Yes", "YES"])).toMatch(/duplicate/i);
    expect(choiceOptionsError(["Yes", "No"])).toBeNull();
  });
});
