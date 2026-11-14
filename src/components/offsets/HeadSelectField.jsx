import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { employeeService } from '../../services/employeeService';
import { headResolver } from '../../services/headResolver';
import { FieldBox } from "@/components/ui/FieldBox";
import { SelectField } from "@/components/ui/SelectField";

/**
 * Lets the applicant confirm (or override) which department head this
 * request routes to for approval (issue #137). Auto-selects the best match
 * from headResolver based on the applicant's department/sub-department, but
 * the applicant can pick a different head if the suggestion is wrong — the
 * service layer trusts whatever headId is submitted here.
 *
 * When the team has two heads nothing is guessed (#138): the box stays empty,
 * the team's heads are listed first and a note explains why (#1005).
 */
export default function HeadSelectField({ employee, value, onChange, required = false, error }) {
  const { data: heads = [] } = useQuery({
    queryKey: ['departmentHeads'],
    queryFn: async () => {
      const all = await employeeService.getAllEmployees();
      return all.filter((e) => e.isHead).sort((a, b) => a.name.localeCompare(b.name));
    },
  });

  const target = useMemo(
    () => ({
      department: employee?.department,
      sub_department: employee?.sub_department || employee?.subDepartment,
    }),
    [employee],
  );
  const teamHeads = useMemo(() => headResolver.resolveHeads(target, heads), [target, heads]);
  // The no-guess rule: only a single team head is picked for the applicant.
  const suggested = useMemo(() => headResolver.resolveHead(target, heads), [target, heads]);
  const isTie = teamHeads.length > 1 && !suggested;

  const options = useMemo(() => {
    const teamIds = new Set(teamHeads.map((h) => h.id));
    const rest = heads.filter((h) => !teamIds.has(h.id));
    const label = (h, team) => {
      const where = [h.department, h.sub_department].filter(Boolean).join(' / ');
      return `${team ? 'Your team: ' : ''}${h.name}${where ? ` (${where})` : ''}`;
    };
    return [
      ...teamHeads.map((h) => ({ value: h.id, label: label(h, true) })),
      ...rest.map((h) => ({ value: h.id, label: label(h, false) })),
    ];
  }, [heads, teamHeads]);

  useEffect(() => {
    if (!value && suggested?.id) {
      onChange(suggested.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggested]);

  return (
    <div>
      <FieldBox label="Department Head" required={required} className="block mb-1.5" />
      <SelectField
        value={value || null}
        onChange={onChange}
        options={options}
        placeholder="Select head..."
        error={!!error}
        className="w-full"
      />
      {isTie && !value && (
        <p className="text-[10px] font-semibold text-muted-foreground px-1 pt-1">
          Your team has {teamHeads.length} heads. Pick the one you report to.
        </p>
      )}
      {suggested && value === suggested.id && (
        <p className="text-[10px] font-semibold text-muted-foreground px-1 pt-1">
          Auto-routed to your department head based on your department/sub-department.
        </p>
      )}
      {error && (
        <p role="alert" className="px-1 pt-1 text-xs font-semibold text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
