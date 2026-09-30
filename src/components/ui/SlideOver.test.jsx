import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SlideOver, { SlideOverBody, SlideOverFooter } from "./SlideOver";

const rec = { id: "a", ref: "T-1", name: "Fix login" };
const identity = (r) => ({ ref: r.ref, title: r.name, subtitle: "submitted today" });

function ui(props = {}) {
  return (
    <SlideOver record={rec} crumb="Queue" identity={identity} index={2} total={5} onStep={() => {}} onClose={() => {}} {...props}>
      {(r) => (
        <>
          <SlideOverBody>body of {r.name}</SlideOverBody>
          <SlideOverFooter>decide</SlideOverFooter>
        </>
      )}
    </SlideOver>
  );
}

describe("SlideOver", () => {
  it("shows identity, position count, body and footer", () => {
    render(ui());
    expect(screen.getByText("Fix login")).toBeInTheDocument();
    expect(screen.getByText("T-1")).toBeInTheDocument();
    expect(screen.getByText("3 / 5")).toBeInTheDocument();
    expect(screen.getByText("body of Fix login")).toBeInTheDocument();
    expect(screen.getByText("decide")).toBeInTheDocument();
  });

  it("renders nothing without a record", () => {
    render(ui({ record: null }));
    expect(screen.queryByText("Fix login")).not.toBeInTheDocument();
  });

  it("steps with the buttons and J / K, disabled at the ends", () => {
    const onStep = vi.fn();
    const { rerender } = render(ui({ onStep }));
    fireEvent.click(screen.getByLabelText(/next record/i));
    fireEvent.click(screen.getByLabelText(/previous record/i));
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "k" });
    expect(onStep.mock.calls.map((c) => c[0])).toEqual([1, -1, 1, -1]);
    rerender(ui({ onStep, index: 0 }));
    expect(screen.getByLabelText(/previous record/i)).toBeDisabled();
  });

  it("closes from the close button, crumb and Escape", () => {
    const onClose = vi.fn();
    render(ui({ onClose }));
    fireEvent.click(screen.getByLabelText("Close"));
    fireEvent.click(screen.getByText("Queue"));
    fireEvent.keyDown(screen.getByText("Fix login"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("offers Open full only when a handler is given", () => {
    const onOpenFull = vi.fn();
    const { rerender } = render(ui());
    expect(screen.queryByLabelText("Open full")).not.toBeInTheDocument();
    rerender(ui({ onOpenFull }));
    fireEvent.click(screen.getByLabelText("Open full"));
    expect(onOpenFull).toHaveBeenCalledWith(rec);
  });
});
