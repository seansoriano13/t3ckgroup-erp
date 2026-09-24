import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { employeeService } from '../../services/employeeService';
import { headResolver } from '../../services/headResolver';
import { FieldBox } from "@/components/ui/FieldBox";

/**
 * Lets the applicant confirm (or override) which department head this
 * request routes to for approval (issue #137). Auto-selects the best match
 * from headResolver based on the applicant's department/sub-department, but
 * the applicant can pick a different head if the suggestion is wrong — the
 * service layer trusts whatever headId is submitted here.
 */
export default function HeadSelectField({ employee, value, onChange, required = true }) {
  const { data: heads = [] } = useQuery({
    queryKey: ['departmentHeads'],
    queryFn: async () => {
      const all = await employeeService.getAllEmployees();
      return all.filter((e) => e.isHead).sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  const suggested = useMemo(() => {
    if (!employee || !heads.length) return null;
    return headResolver.resolveHead(
      { department: employee.department, sub_department: employee.sub_department || employee.subDepartment },
      heads,
    );
  }, [employee, heads]);

  useEffect(() => {
    if (!value && suggested?.id) {
      onChange(suggested.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggested]);

  return (
    <div>
      <FieldBox label="Department Head" className="block mb-1.5" />
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3.5 py-2.5 bg-muted border border-border rounded-xl text-sm font-semibold text-foreground focus:outline-none focus:border-foreground/30 appearance-none"
        required={required}
      >
        <option value="" disabled>Select head...</option>
        {heads.map((h) => (
          <option key={h.id} value={h.id}>{h.name}</option>
        ))}
      </select>
      {suggested && value === suggested.id && (
        <p className="text-[10px] font-semibold text-muted-foreground px-1 pt-1">
          Auto-routed to your department head based on your department/sub-department.
        </p>
      )}
    </div>
  );
}
