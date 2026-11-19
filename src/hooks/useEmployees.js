import { useQuery } from "@tanstack/react-query";
import { employeeService } from "../services/employeeService";

export const EMPLOYEES_KEY = ["employees"];

/** The staff list changes rarely; a few minutes is fresh enough that opening a form twice loads it once. */
export const EMPLOYEES_STALE_MS = 5 * 60 * 1000;

/** Everyone on the staff list, shared under one key by every form that needs names. */
export function useEmployees(options = {}) {
  return useQuery({
    queryKey: EMPLOYEES_KEY,
    queryFn: () => employeeService.getAllEmployees(),
    staleTime: EMPLOYEES_STALE_MS,
    ...options,
  });
}
