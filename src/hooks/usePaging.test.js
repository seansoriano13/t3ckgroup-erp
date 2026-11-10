import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePaging } from "./usePaging";

const make = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1 }));

describe("usePaging", () => {
  it("returns the first 25 rows by default", () => {
    const { result } = renderHook(() => usePaging(make(60)));
    expect(result.current.rows).toHaveLength(25);
    expect(result.current.rows[0].id).toBe(1);
    expect(result.current.totalPages).toBe(3);
    expect(result.current.total).toBe(60);
  });

  it("moves between pages", () => {
    const { result } = renderHook(() => usePaging(make(60)));
    act(() => result.current.setPage(3));
    expect(result.current.rows.map((r) => r.id)).toEqual(make(60).slice(50).map((r) => r.id));
  });

  it("returns to page 1 when the page size changes", () => {
    const { result } = renderHook(() => usePaging(make(60)));
    act(() => result.current.setPage(3));
    act(() => result.current.setPageSize(10));
    expect(result.current.page).toBe(1);
    expect(result.current.rows).toHaveLength(10);
  });

  it("clamps the page when the list shrinks", () => {
    let items = make(60);
    const { result, rerender } = renderHook(() => usePaging(items));
    act(() => result.current.setPage(3));
    items = make(30);
    rerender();
    expect(result.current.page).toBe(2);
    expect(result.current.rows).toHaveLength(5);
  });

  it("is one empty page for an empty list", () => {
    const { result } = renderHook(() => usePaging([]));
    expect(result.current.totalPages).toBe(1);
    expect(result.current.rows).toEqual([]);
  });
});
