import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { useRecordParam } from "./useRecordParam";

function setup(initial = "/approvals/tasks") {
  const wrapper = ({ children }) => <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>;
  return renderHook(() => ({ rec: useRecordParam(), loc: useLocation() }), { wrapper });
}

describe("useRecordParam", () => {
  it("reads the record from the URL on mount", () => {
    const { result } = setup("/approvals/tasks?record=abc");
    expect(result.current.rec.recordId).toBe("abc");
  });

  it("open writes ?record=, keeping other params", () => {
    const { result } = setup("/approvals/tasks?tab=x");
    act(() => result.current.rec.open("t1"));
    expect(result.current.rec.recordId).toBe("t1");
    expect(result.current.loc.search).toBe("?tab=x&record=t1");
  });

  it("close clears it", () => {
    const { result } = setup("/approvals/tasks?record=t1&tab=x");
    act(() => result.current.rec.close());
    expect(result.current.rec.recordId).toBeNull();
    expect(result.current.loc.search).toBe("?tab=x");
  });

  it("step moves to another record", () => {
    const { result } = setup("/approvals/tasks?record=t1");
    act(() => result.current.rec.step("t2"));
    expect(result.current.rec.recordId).toBe("t2");
  });
});
