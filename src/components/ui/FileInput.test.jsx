import { describe, it, expect, vi } from "vitest";
import { createRef } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileInput } from "./FileInput";

const inputOf = (container) => container.querySelector('input[type="file"]');
const png = () => new File(["x"], "a.png", { type: "image/png" });

describe("FileInput", () => {
  it("calls onFiles with the picked files as an array", () => {
    const onFiles = vi.fn();
    const { container } = render(<FileInput onFiles={onFiles}>Attach</FileInput>);
    const file = png();
    fireEvent.change(inputOf(container), { target: { files: [file] } });
    expect(onFiles).toHaveBeenCalledWith([file]);
  });

  it("does not call onFiles when the pick is cancelled", () => {
    const onFiles = vi.fn();
    const { container } = render(<FileInput onFiles={onFiles} />);
    fireEvent.change(inputOf(container), { target: { files: [] } });
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("honours accept and multiple", () => {
    const { container } = render(<FileInput accept="image/png" multiple />);
    const input = inputOf(container);
    expect(input).toHaveAttribute("accept", "image/png");
    expect(input).toHaveAttribute("multiple");
  });

  it("opens the picker from the trigger", () => {
    const { container } = render(<FileInput>Attach</FileInput>);
    const click = vi.spyOn(inputOf(container), "click");
    fireEvent.click(screen.getByRole("button", { name: "Attach" }));
    expect(click).toHaveBeenCalled();
  });

  it("opens the picker through the ref when there is no trigger", () => {
    const ref = createRef();
    const { container } = render(<FileInput ref={ref} />);
    expect(screen.queryByRole("button")).toBeNull();
    const click = vi.spyOn(inputOf(container), "click");
    ref.current.open();
    expect(click).toHaveBeenCalled();
  });

  it("is inert when disabled", () => {
    const ref = createRef();
    const { container } = render(
      <FileInput ref={ref} disabled>
        Attach
      </FileInput>,
    );
    const input = inputOf(container);
    const click = vi.spyOn(input, "click");
    expect(input).toBeDisabled();
    expect(screen.getByRole("button", { name: "Attach" })).toBeDisabled();
    ref.current.open();
    expect(click).not.toHaveBeenCalled();
  });
});
