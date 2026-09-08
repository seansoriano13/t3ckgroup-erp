import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ChecklistTaskInput from "./ChecklistTaskInput";

describe("ChecklistTaskInput", () => {
  it("renders a single default item row initially when empty", () => {
    render(<ChecklistTaskInput value="" onChange={vi.fn()} />);

    const itemInputs = screen.getAllByPlaceholderText("List detailed condition...");
    expect(itemInputs).toHaveLength(1);
    expect(itemInputs[0].value).toBe("");

    // Section header should not be visible when unsectioned
    expect(screen.queryByPlaceholderText(/Section title/)).not.toBeInTheDocument();
  });

  it("renders flat items and emits flat JSON when items change", () => {
    const handleChange = vi.fn();
    const initial = JSON.stringify([
      { text: "Item 1", checked: false },
      { text: "Item 2", checked: true },
    ]);

    render(<ChecklistTaskInput value={initial} onChange={handleChange} />);

    const itemInputs = screen.getAllByPlaceholderText("List detailed condition...");
    expect(itemInputs).toHaveLength(2);
    expect(itemInputs[0].value).toBe("Item 1");
    expect(itemInputs[1].value).toBe("Item 2");

    // Type into first item
    fireEvent.change(itemInputs[0], { target: { value: "Item 1 updated" } });
    expect(handleChange).toHaveBeenCalled();

    const emitted = JSON.parse(handleChange.mock.calls[0][0].target.value);
    expect(Array.isArray(emitted)).toBe(true);
    // Emitted should be flat array of { text, checked }
    expect(emitted[0]).toEqual({ text: "Item 1 updated", checked: false });
    expect(emitted[1]).toEqual({ text: "Item 2", checked: true });
  });

  it("switches to grouped format when 'Add Section / Steps' is clicked", () => {
    const handleChange = vi.fn();
    const initial = JSON.stringify([{ text: "Prep workspace", checked: false }]);

    render(<ChecklistTaskInput value={initial} onChange={handleChange} />);

    const addSectionBtn = screen.getByRole("button", { name: /Add Section \/ Steps/i });
    fireEvent.click(addSectionBtn);

    // Now section title inputs appear
    const titleInputs = screen.getAllByPlaceholderText(/Section title/i);
    expect(titleInputs.length).toBeGreaterThanOrEqual(2);

    expect(handleChange).toHaveBeenCalled();
    const emitted = JSON.parse(handleChange.mock.calls[0][0].target.value);
    expect(Array.isArray(emitted)).toBe(true);
    expect(emitted[0]).toHaveProperty("title");
    expect(emitted[0]).toHaveProperty("items");
  });

  it("handles Enter key by adding a new item row", () => {
    const handleChange = vi.fn();
    render(<ChecklistTaskInput value="" onChange={handleChange} />);

    const input = screen.getByPlaceholderText("List detailed condition...");
    fireEvent.change(input, { target: { value: "First item" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    const itemInputs = screen.getAllByPlaceholderText("List detailed condition...");
    expect(itemInputs).toHaveLength(2);
  });
});
