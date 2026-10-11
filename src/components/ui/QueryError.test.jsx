import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import QueryError from "./QueryError";

describe("QueryError", () => {
  it("says it failed and Retry calls onRetry", () => {
    const onRetry = vi.fn();
    render(<QueryError title="Things could not be loaded." onRetry={onRetry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Things could not be loaded.");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
