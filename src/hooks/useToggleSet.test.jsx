import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useToggleSet } from "./useToggleSet";

describe("useToggleSet", () => {
  it("starts empty, adds an absent id and removes a present one", () => {
    const { result } = renderHook(() => useToggleSet());
    expect(result.current[0].size).toBe(0);

    act(() => result.current[1]("a"));
    expect(result.current[0].has("a")).toBe(true);

    act(() => result.current[1]("b"));
    act(() => result.current[1]("a"));
    expect([...result.current[0]]).toEqual(["b"]);
  });

  it("hands back a new Set each time so React re-renders", () => {
    const { result } = renderHook(() => useToggleSet());
    const before = result.current[0];
    act(() => result.current[1]("a"));
    expect(result.current[0]).not.toBe(before);
  });
});
