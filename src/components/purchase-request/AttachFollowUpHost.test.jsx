import { describe, it, expect, vi } from "vitest";
import { act, render } from "@testing-library/react";

vi.mock("./AttachToOthers", () => ({
  AttachToOthers: ({ poNumber }) => <div data-testid="attach-to-others">{poNumber}</div>,
}));

import AttachFollowUpHost, { showAttachFollowUp } from "./AttachFollowUpHost";

const step = (requestId) => ({ requestId, offer: { offered: [{ id: "i1" }] }, poNumber: "P01423", orderEarly: false, earlyReason: "" });

describe("the attach follow-up host", () => {
  it("says no when no list is mounted, so the dialog keeps the step itself", () => {
    expect(showAttachFollowUp(step("r1"))).toBe(false);
  });

  it("shows the step for its own request and keeps it until closed", () => {
    const { getByTestId, queryByTestId, rerender } = render(<AttachFollowUpHost requestId="r1" />);
    expect(queryByTestId("attach-to-others")).toBeNull();

    act(() => {
      expect(showAttachFollowUp(step("r1"))).toBe(true);
    });
    expect(getByTestId("attach-to-others")).toHaveTextContent("P01423");

    // The list re-renders (a row folded, a status changed): the step stays.
    rerender(<AttachFollowUpHost requestId="r1" />);
    expect(getByTestId("attach-to-others")).toBeInTheDocument();
  });

  it("ignores a step for another request", () => {
    const { queryByTestId } = render(<AttachFollowUpHost requestId="r2" />);
    act(() => {
      showAttachFollowUp(step("r1"));
    });
    expect(queryByTestId("attach-to-others")).toBeNull();
  });
});
