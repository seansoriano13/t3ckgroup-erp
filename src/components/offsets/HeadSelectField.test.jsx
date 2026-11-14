import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import HeadSelectField from './HeadSelectField';

vi.mock('../../services/employeeService', () => ({ employeeService: { getAllEmployees: vi.fn() } }));
vi.mock('@/components/ui/SelectField', () => ({
  SelectField: ({ options, value }) => (
    <ul data-value={value ?? ''}>{options.map((o) => <li key={o.value}>{o.label}</li>)}</ul>
  ),
}));

import { employeeService } from '../../services/employeeService';

const head = (id, name, department, sub_department = null) => ({ id, name, department, sub_department, isHead: true });
const all = [
  head('a', 'Abe', 'Admin'),
  head('g', 'Grace', 'Sales', 'NGO'),
  head('s', 'Shara', 'Sales', 'NGO'),
  head('t', 'Tom', 'Tech'),
];

function setup(employee) {
  employeeService.getAllEmployees.mockResolvedValue(all);
  const onChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <HeadSelectField employee={employee} value={null} onChange={onChange} />
    </QueryClientProvider>,
  );
  return onChange;
}

describe('HeadSelectField', () => {
  beforeEach(() => vi.clearAllMocks());

  it('explains a tie, picks nothing, lists team heads first with departments', async () => {
    const onChange = setup({ department: 'Sales', sub_department: 'NGO' });
    expect(await screen.findByText('Your team has 2 heads. Pick the one you report to.')).toBeTruthy();
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items.slice(0, 2)).toEqual(['Your team: Grace (Sales / NGO)', 'Your team: Shara (Sales / NGO)']);
    expect(items).toContain('Abe (Admin)');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('auto-picks a single team head and shows no tie note', async () => {
    const onChange = setup({ department: 'Tech' });
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('t'));
    expect(screen.queryByText(/heads\. Pick/)).toBeNull();
  });
});
