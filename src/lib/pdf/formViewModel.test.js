import { describe, it, expect } from 'vitest';
import {
  getRecordNumber,
  getTreatedAs,
  getBalanceLedger,
  getFiledStatus,
  getShortSigId,
  getSignedStamp,
  buildTG11ViewModel,
  buildTG12ViewModel,
} from './formViewModel';

const employee = { name: 'Alvin Roa', role: 'Logistics Assistant', department: 'Operations', sub_department: 'Logistics', employment_status: 'Regular' };

describe('getRecordNumber', () => {
  it('prefixes a leave/offset record LV and an overtime record OT, from the created year and id', () => {
    expect(getRecordNumber({ type: 'OFFSET', id: 'abcd1234-...', created_at: '2026-08-18T00:00:00Z' })).toBe('LV-2026-ABCD');
    expect(getRecordNumber({ type: 'OVERTIME', id: 'abcd1234-...', created_at: '2026-08-18T00:00:00Z' })).toBe('OT-2026-ABCD');
  });
});

describe('getTreatedAs', () => {
  it('labels SIL and OFFSET distinctly', () => {
    expect(getTreatedAs({ type: 'SIL' })).toBe('Service Incentive Leave');
    expect(getTreatedAs({ type: 'OFFSET' })).toBe('Offset');
  });
});

describe('getBalanceLedger', () => {
  it('derives the prior balance arithmetically from the post-approval snapshot', () => {
    expect(getBalanceLedger({ approval_credits_snapshot: 15.5, hours: 8 })).toBe('23.5 → 15.5 hrs remaining');
  });

  it('returns null when there is no snapshot to report (never printed for a record that was never approved)', () => {
    expect(getBalanceLedger({ approval_credits_snapshot: null, hours: 8 })).toBeNull();
  });
});

describe('getFiledStatus', () => {
  it('reuses the lateness rule', () => {
    expect(getFiledStatus({ startDate: '2026-08-18', created_at: '2026-08-17T10:00:00Z' })).toBe('On time');
    expect(getFiledStatus({ startDate: '2026-08-18', created_at: '2026-08-19T10:00:00Z' })).toBe('Late filing');
  });
});

describe('getShortSigId', () => {
  it('derives a short, stable fragment of the storage path rather than claiming a version counter', () => {
    expect(getShortSigId('employee-id/9f3a7c21-abcd.png')).toBe('bcdpng');
    expect(getShortSigId(null)).toBeNull();
  });
});

describe('getSignedStamp', () => {
  it('formats a signed timestamp with a short signature id', () => {
    const stamp = getSignedStamp('2026-08-26T09:14:00Z', 'emp/abc123.png');
    expect(stamp).toMatch(/^e-signed .+ · \d{2}:\d{2} · sig [a-z0-9]{6}$/);
  });

  it('returns null when there is no timestamp', () => {
    expect(getSignedStamp(null, 'emp/abc123.png')).toBeNull();
  });
});

describe('buildTG11ViewModel', () => {
  const record = {
    type: 'OFFSET',
    id: 'abcd1234',
    created_at: '2026-08-26T00:00:00Z',
    startDate: '2026-08-28',
    date: '2026-08-28',
    hours: 8,
    status: 'APPROVED',
    reason: 'Offsetting overtime',
    approval_credits_snapshot: 15.5,
    employee_signature_timestamp: '2026-08-26T09:14:00Z',
    employee_signature_version: 'emp/abc123.png',
    hr_processed_by: 'hr-1',
    updated_at: '2026-08-26T00:00:00Z',
    hr: { name: 'G. B. Mateo' },
    employee,
    category: { label: 'Vacation Leave' },
    verification_token: 'tok123',
  };
  const formSettings = { supervisor_name: 'Grace Aragon', supervisor_title: 'Immediate supervisor' };

  it('never omits the employee-signature plate, and adds the supervisor as a wet plate', () => {
    const vm = buildTG11ViewModel(record, formSettings);
    expect(vm.sigs).toHaveLength(2);
    expect(vm.sigs[0]).toMatchObject({ role: 'Employee', state: 'signed' });
    expect(vm.sigs[1]).toMatchObject({ role: 'Noted by', who: 'Grace Aragon', state: 'wet' });
  });

  it('omits the supervisor plate when no supervisor name is configured', () => {
    const vm = buildTG11ViewModel(record, {});
    expect(vm.sigs).toHaveLength(1);
  });

  it('reports the hours-applied figure, not an approved/requested split (leave has no override)', () => {
    const vm = buildTG11ViewModel(record, formSettings);
    expect(vm.bigK).toBe('Hours applied');
    expect(vm.bigN).toBe('8');
  });

  it('never fabricates a field the schema does not back — no employee number field', () => {
    const vm = buildTG11ViewModel(record, formSettings);
    expect(vm.fields.map((f) => f.k)).not.toContain('Employee no.');
  });
});

describe('buildTG12ViewModel', () => {
  const record = {
    type: 'OVERTIME',
    id: 'ffff9999',
    created_at: '2026-08-13T00:00:00Z',
    date: '2026-08-04',
    startDate: '2026-08-04',
    start_time: '16:00',
    end_time: '18:30',
    hours: 4,
    approved_hours: 3.5,
    status: 'APPROVED_OFFSET',
    reason: 'Deployment hand-off',
    approval_credits_snapshot: 27,
    employee_signature_timestamp: '2026-08-13T17:02:00Z',
    employee_signature_version: 'emp/def456.png',
    hr: { name: 'G. B. Mateo' },
    updated_at: '2026-08-17T00:00:00Z',
    employee,
    verification_token: 'tok456',
  };
  const formSettings = { supervisor_name: 'Grace Aragon', approver_name: 'R. D. Villanueva', approver_title: 'Operations manager' };

  it('carries three signature plates: employee, supervisor, and the approving officer', () => {
    const vm = buildTG12ViewModel(record, formSettings);
    expect(vm.sigs.map((s) => s.role)).toEqual(['Employee', 'Noted by', 'Approved by']);
    expect(vm.sigs[2]).toMatchObject({ who: 'R. D. Villanueva', title: 'Operations manager', state: 'wet' });
  });

  it('shows the credited figure as the big number and the requested figure struck through', () => {
    const vm = buildTG12ViewModel(record, formSettings);
    expect(vm.bigK).toBe('Hours approved');
    expect(vm.bigN).toBe('3.5');
    expect(vm.requestedHours).toBe('4');
  });

  it('shows no strike when HR credited exactly what was requested', () => {
    const vm = buildTG12ViewModel({ ...record, hours: 4, approved_hours: 4 }, formSettings);
    expect(vm.requestedHours).toBeNull();
  });

  it('reports the outcome label from status', () => {
    expect(buildTG12ViewModel(record, formSettings).outcome).toBe('OFFSET CREDIT');
  });
});
