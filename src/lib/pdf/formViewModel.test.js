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
  buildTG13ViewModel,
  getValidationStamp,
} from './formViewModel';

const employee = { name: 'Alvin Roa', role: 'Logistics Assistant', department: 'Operations', sub_department: 'Logistics', employment_status: 'Regular' };

describe('getRecordNumber', () => {
  it('prefixes a leave/offset record LV and an overtime record OT, from the created year and id', () => {
    expect(getRecordNumber({ type: 'OFFSET', id: 'abcd1234-...', created_at: '2026-08-18T00:00:00Z' })).toBe('LV-2026-ABCD');
    expect(getRecordNumber({ type: 'OVERTIME', id: 'abcd1234-...', created_at: '2026-08-18T00:00:00Z' })).toBe('OT-2026-ABCD');
  });

  it('prefixes an undertime record UT', () => {
    expect(getRecordNumber({ type: 'UNDERTIME', id: 'abcd1234-...', created_at: '2026-08-18T00:00:00Z' })).toBe('UT-2026-ABCD');
  });

  it('fails loudly on an unknown record type rather than defaulting to a leave form', () => {
    expect(() => getRecordNumber({ type: 'SOMETHING_ELSE', id: 'abcd1234' })).toThrow(/unknown form record type/i);
  });
});

describe('getTreatedAs', () => {
  it('labels SIL and OFFSET distinctly', () => {
    expect(getTreatedAs({ type: 'SIL' })).toBe('Leave With Pay (LWP)');
    expect(getTreatedAs({ type: 'OFFSET' })).toBe('Offset');
  });
});

describe('getBalanceLedger', () => {
  it('derives the prior balance arithmetically from the post-approval snapshot', () => {
    expect(getBalanceLedger({ approval_credits_snapshot: 15.5, hours: 8 })).toBe('23.5 â†’ 15.5 hrs remaining');
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
    expect(stamp).toMatch(/^e-signed .+ Â· \d{2}:\d{2} Â· sig [a-z0-9]{6}$/);
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

  it('carries the fixed TG-11 label', () => {
    expect(buildTG11ViewModel(record).formLabel).toBe('TG-11');
  });

  it('always carries exactly three signature plates, in order: Requested by, Approved by, Noted by', () => {
    const vm = buildTG11ViewModel(record);
    expect(vm.sigs.map((s) => s.role)).toEqual(['Requested by', 'Approved by', 'Noted by']);
    expect(vm.sigs[0]).toMatchObject({ state: 'signed' });
  });

  it('states the two-day filing rule in its footer', () => {
    expect(buildTG11ViewModel(record).note).toBe(
      'This form must be filed at least two (2) days before the leave commences, or immediately upon return for emergency or sick leave.'
    );
  });

  it('reports the hours-applied figure, not an approved/requested split (leave has no override)', () => {
    const vm = buildTG11ViewModel(record);
    expect(vm.bigK).toBe('Hours applied');
    expect(vm.bigN).toBe('8');
  });

  it('never fabricates a field the schema does not back â€” no employee number field', () => {
    const vm = buildTG11ViewModel(record);
    expect(vm.fields.map((f) => f.k)).not.toContain('Employee no.');
  });

  it('prints the company recorded on the application (issue #142), not the employee\'s current one', () => {
    const vm = buildTG11ViewModel({ ...record, company: { name: 'TG Global Trade OPC' } });
    expect(vm.company).toBe('TG Global Trade OPC');
  });

  it('never fabricates a company when the record has none â€” prints blank, not a guess', () => {
    const vm = buildTG11ViewModel(record);
    expect(vm.company).toBeNull();
  });
});

describe('the one signature band (issue #153)', () => {
  const base = {
    type: 'OVERTIME',
    id: 'ffff9999',
    created_at: '2026-08-13T00:00:00Z',
    date: '2026-08-04',
    hours: 4,
    approved_hours: 4,
    status: 'APPROVED_PAID',
    employee,
  };

  it('renders the approver plate signed when the head has decided', () => {
    const vm = buildTG12ViewModel({
      ...base,
      head_id: 'head-1',
      head: { name: 'R. D. Villanueva' },
      head_status: 'APPROVED',
      head_decided_at: '2026-08-13T10:00:00Z',
      head_signature_version: 'head/abc.png',
    });
    const approved = vm.sigs.find((s) => s.role === 'Approved by');
    expect(approved).toMatchObject({ who: 'R. D. Villanueva', state: 'signed', signaturePath: 'head/abc.png' });
  });

  it('renders the approver plate as a ruled line, still captioned "Approved by", when the head has not decided yet', () => {
    const vm = buildTG12ViewModel({ ...base, head_id: 'head-1', head: { name: 'R. D. Villanueva' }, head_status: 'PENDING' });
    const approved = vm.sigs.find((s) => s.role === 'Approved by');
    expect(approved).toMatchObject({ state: 'wet' });
  });

  it('never omits the approver plate for a record predating the head stage, and does not error', () => {
    const vm = buildTG12ViewModel({ ...base });
    expect(() => vm).not.toThrow();
    const approved = vm.sigs.find((s) => s.role === 'Approved by');
    expect(approved).toMatchObject({ role: 'Approved by', state: 'wet' });
    expect(vm.sigs).toHaveLength(3);
  });

  it('renders the noted plate from the real HR officer who processed it, not a typed setting', () => {
    const vm = buildTG12ViewModel({
      ...base,
      hr: { name: 'G. B. Mateo' },
      hr_processed_by: 'hr-1',
      hr_signature_timestamp: '2026-08-14T09:00:00Z',
      hr_signature_version: 'hr/def.png',
    });
    const noted = vm.sigs.find((s) => s.role === 'Noted by');
    expect(noted).toMatchObject({ who: 'G. B. Mateo', state: 'signed', signaturePath: 'hr/def.png' });
  });

  it('renders the noted plate as a ruled line when HR has not processed it yet, never omitting the column', () => {
    const vm = buildTG12ViewModel({ ...base });
    const noted = vm.sigs.find((s) => s.role === 'Noted by');
    expect(noted).toMatchObject({ role: 'Noted by', state: 'wet' });
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
  it('carries the fixed TG-12 label and exactly three signature plates, in order', () => {
    const vm = buildTG12ViewModel(record);
    expect(vm.formLabel).toBe('TG-12');
    expect(vm.sigs.map((s) => s.role)).toEqual(['Requested by', 'Approved by', 'Noted by']);
  });

  it('states the exact overtime filing rule in its footer', () => {
    expect(buildTG12ViewModel(record).note).toBe(
      'This form must be filed a day before the scheduled OT, or at least four (4) hours in advance in the case of unscheduled OT.'
    );
  });

  it('shows the credited figure as the big number and the requested figure struck through', () => {
    const vm = buildTG12ViewModel(record);
    expect(vm.bigK).toBe('Hours approved');
    expect(vm.bigN).toBe('3.5');
    expect(vm.requestedHours).toBe('4');
  });

  it('shows no strike when HR credited exactly what was requested', () => {
    const vm = buildTG12ViewModel({ ...record, hours: 4, approved_hours: 4 });
    expect(vm.requestedHours).toBeNull();
  });

  it('has no Outcome block, so OFFSET CREDIT never prints', () => {
    expect(buildTG12ViewModel(record).outcome).toBeUndefined();
  });

  it('prints the company recorded on the request, and blank when absent (issue #142)', () => {
    expect(buildTG12ViewModel({ ...record, company: { name: 'Store CDO' } }).company).toBe('Store CDO');
    expect(buildTG12ViewModel(record).company).toBeNull();
  });
});

describe('buildTG13ViewModel', () => {
  const record = {
    type: 'UNDERTIME',
    id: 'aaaa1111',
    created_at: '2026-08-20T00:00:00Z',
    date: '2026-08-20',
    original_start_time: '08:00',
    original_end_time: '17:00',
    actual_start_time: '08:00',
    actual_end_time: '15:00',
    hours: 2,
    approved_hours: 2,
    status: 'APPROVED',
    reason: 'Medical appointment',
    hr_processed_at: '2026-08-21T00:00:00Z',
    employee_signature_timestamp: '2026-08-20T07:55:00Z',
    employee_signature_version: 'emp/ut1.png',
    employee,
    verification_token: 'tok789',
  };

  it('carries the fixed TG-13 label and exactly three signature plates, in order', () => {
    const vm = buildTG13ViewModel(record);
    expect(vm.formLabel).toBe('TG-13');
    expect(vm.sigs.map((s) => s.role)).toEqual(['Requested by', 'Approved by', 'Noted by']);
  });

  it('reports the total-hours figure with no balance row', () => {
    const vm = buildTG13ViewModel(record);
    expect(vm.bigK).toBe('Total no. of hours');
    expect(vm.bigN).toBe('2');
    expect(vm.hrd.map((h) => h[0])).not.toContain('Offset balance');
  });
});

describe('printed form titles and field lists (issue #612)', () => {
  const rec = { id: 'abcd1234', type: 'SIL', status: 'APPROVED', created_at: '2026-08-01T00:00:00Z', date: '2026-08-05', hours: 8, employee: { name: 'A', employment_status: 'Regular' } };
  it('TG-11 title and exact fields', () => {
    const vm = buildTG11ViewModel(rec);
    expect(vm.kind).toBe('Application for Leave / Offset Form');
    expect(vm.fields.map((f) => f.k)).toEqual(['Date filed', 'Inclusive dates', 'Treated as']);
    expect(vm.outcome).toBeTruthy();
  });
  it('TG-11 treated as maps SIL and Offset', () => {
    expect(buildTG11ViewModel(rec).fields[2].v).toBe('Leave With Pay (LWP)');
    expect(buildTG11ViewModel({ ...rec, type: 'OFFSET' }).fields[2].v).toBe('Offset');
  });
  it('TG-11 treated as reads Leave Without Pay (LWOP) for an LWOP, with an LV record number (#621)', () => {
    const vm = buildTG11ViewModel({ ...rec, type: 'LWOP' });
    expect(vm.fields[2].v).toBe('Leave Without Pay (LWOP)');
    expect(getRecordNumber({ ...rec, type: 'LWOP' })).toMatch(/^LV-/);
  });
  it('TG-12 title and exact fields', () => {
    const vm = buildTG12ViewModel({ ...rec, type: 'OVERTIME' });
    expect(vm.kind).toBe('Overtime Authorization Form');
    expect(vm.fields.map((f) => f.k)).toEqual(['Date filed', 'Date of overtime', 'Time window']);
  });
  it('TG-13 title, exact fields and outcome', () => {
    const vm = buildTG13ViewModel({ ...rec, type: 'UNDERTIME' });
    expect(vm.kind).toBe('Undertime Request Form');
    expect(vm.fields.map((f) => f.k)).toEqual(['Date filed', 'Date of undertime', 'Original work schedule', 'Actual work schedule']);
    expect(vm.outcome).toBeTruthy();
  });
  it('record number prefixes are unchanged', () => {
    expect(getRecordNumber({ ...rec, type: 'SIL' })).toMatch(/^LV-/);
    expect(getRecordNumber({ ...rec, type: 'OFFSET' })).toMatch(/^LV-/);
    expect(getRecordNumber({ ...rec, type: 'OVERTIME' })).toMatch(/^OT-/);
    expect(getRecordNumber({ ...rec, type: 'UNDERTIME' })).toMatch(/^UT-/);
  });
});

describe('validation date fallback (issue #614)', () => {
  const stamp = (vm) => vm.hrd.find((h) => h[0] === 'Validation date')[1];
  const base = { id: 'abcd1234', created_at: '2026-10-01T00:00:00Z', status: 'APPROVED', employee, hr: { name: 'HR' } };
  // 2026-10-14T07:27:00Z is 3:27 PM in Manila.
  const cases = [
    ['TG-11', buildTG11ViewModel, 'OFFSET'],
    ['TG-12', buildTG12ViewModel, 'OVERTIME'],
    ['TG-13', buildTG13ViewModel, 'UNDERTIME'],
  ];

  for (const [label, build, type] of cases) {
    it(`${label}: hr_processed_at wins, with date and time`, () => {
      const vm = build({ ...base, type, hr_processed_at: '2026-10-14T07:27:00Z', hr_signature_timestamp: '2026-10-10T01:00:00Z', updated_at: '2026-10-20T00:00:00Z' });
      expect(stamp(vm)).toBe('Oct 14, 2026 · 3:27 PM');
    });
    it(`${label}: falls back to hr_signature_timestamp, with date and time`, () => {
      const vm = build({ ...base, type, hr_signature_timestamp: '2026-10-14T07:27:00Z', updated_at: '2026-10-20T00:00:00Z' });
      expect(stamp(vm)).toBe('Oct 14, 2026 · 3:27 PM');
    });
    it(`${label}: last falls back to updated_at, date only`, () => {
      const vm = build({ ...base, type, updated_at: '2026-10-14T07:27:00Z' });
      expect(stamp(vm)).toBe('Oct 14, 2026');
    });
    it(`${label}: shows a dash when nothing is recorded`, () => {
      expect(stamp(build({ ...base, type }))).toBe('—');
    });
  }

  it('uses the Manila date near midnight UTC', () => {
    expect(getValidationStamp({ hr_processed_at: '2026-10-14T17:30:00Z' })).toBe('Oct 15, 2026 · 1:30 AM');
  });
});
