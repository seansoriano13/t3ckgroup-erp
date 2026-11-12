import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { employeeService } from "../../services/employeeService";

/** Everyone who can be named an incharge of a standalone evaluation (#966), as select options. */
export function useEmployeeOptions() {
  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => employeeService.getAllEmployees(),
    staleTime: 5 * 60_000,
    retry: false,
  });
  return useMemo(() => employees.filter((e) => !e.is_deleted).map((e) => ({ value: e.id, label: e.name })), [employees]);
}
