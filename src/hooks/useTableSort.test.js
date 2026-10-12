import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTableSort } from "./useTableSort";

const rows = [
  { id: 1, name: "b", n: 2 },
  { id: 2, name: "a", n: null },
  { id: 3, name: "C", n: 10 },
];
const acc = { name: (r) => r.name, n: (r) => r.n };

describe("useTableSort", () => {
  it("keeps original order until a column is clicked", () => {
    const { result } = renderHook(() => useTableSort(rows, acc));
    expect(result.current.sorted.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it("cycles ascending, descending, then back to original", () => {
    const { result } = renderHook(() => useTableSort(rows, acc));
    act(() => result.current.toggle("name"));
    expect(result.current.sorted.map((r) => r.id)).toEqual([2, 1, 3]);
    act(() => result.current.toggle("name"));
    expect(result.current.sorted.map((r) => r.id)).toEqual([3, 1, 2]);
    act(() => result.current.toggle("name"));
    expect(result.current.sorted.map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it("sorts numbers numerically and blanks last in both directions", () => {
    const { result } = renderHook(() => useTableSort(rows, acc));
    act(() => result.current.toggle("n"));
    expect(result.current.sorted.map((r) => r.id)).toEqual([1, 3, 2]);
    act(() => result.current.toggle("n"));
    expect(result.current.sorted.map((r) => r.id)).toEqual([3, 1, 2]);
  });
});
