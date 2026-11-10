import { describe, expect, it } from 'vitest';
import {
  GRID_ROWS_PER_PAGE,
  buildTransmittalViewModel,
  gridPages,
  plate,
  tickRows,
} from './transmittalViewModel';

const line = (overrides = {}) => ({
  id: 'l1',
  description: 'Gate valve [GV-10]',
  quantity: 2,
  unit: 'pcs',
  serialNumbers: '',
  boxQuantity: '1',
  sor: { id: 's1', salesReference: 'SOR-1', projectTitle: 'Pier 3' },
  whInChargeName: null,
  whRating: null,
  techRating: null,
  techInChargeName: null,
  ...overrides,
});

const slip = (overrides = {}) => ({
  number: 'TG03-525',
  state: 'warehouse_checking',
  preparedOn: '2026-10-15',
  origin: 'logistics',
  originOther: null,
  checkWarehouse: true,
  checkTechnical: false,
  checkOther: null,
  priority: 'high',
  entity: 'T3CK Trading',
  productOther: null,
  products: [],
  references: [],
  lines: [line()],
  stages: [{ id: 'st1', stage: 'warehouse_checking', remarks: '', first_signer: null, first_signed_at: null }],
  evidence: [],
  checkBy: { first: null, second: null },
  odooReceivedBy: null,
  odooReceivedAt: null,
  odooReceiptRef: null,
  ...overrides,
});

describe('tick rows', () => {
  it('ticks the origin and prints Others text only on Others', () => {
    const rows = tickRows(slip({ origin: 'other', originOther: 'Customs' }));
    const others = rows.origin.find((o) => o.key === 'other');
    expect(others.ticked).toBe(true);
    expect(others.other).toBe('Customs');
    expect(rows.origin.filter((o) => o.ticked)).toHaveLength(1);
    expect(rows.origin.find((o) => o.key === 'purchasing').ticked).toBe(false);
  });

  it('ticks Warehouse and TCA Technical by their flags and the priority', () => {
    const rows = tickRows(slip({ checkWarehouse: true, checkTechnical: true, priority: 'low' }));
    expect(rows.checking.map((c) => c.ticked)).toEqual([true, true, false]);
    expect(rows.priority.find((p) => p.ticked).key).toBe('low');
  });

  it('prints the ticked reference items and the product with its Others text', () => {
    const rows = tickRows(slip({
      references: [{ id: 'r1', label: 'PO copy' }],
      products: [{ id: 'p1', label: 'Valves' }],
      productOther: 'Spares',
    }));
    expect(rows.references).toEqual([{ key: 'r1', label: 'PO copy', ticked: true }]);
    expect(rows.product).toBe('Valves, Spares');
    expect(rows.company).toBe('T3CK Trading');
  });
});

describe('grid pages', () => {
  it('pads a short slip to the paper length', () => {
    const pages = gridPages([line()]);
    expect(pages).toHaveLength(1);
    expect(pages[0].continued).toBe(false);
    expect(pages[0].rows).toHaveLength(GRID_ROWS_PER_PAGE);
    expect(pages[0].rows[0].kind).toBe('line');
    expect(pages[0].rows.slice(1).every((r) => r.kind === 'blank')).toBe(true);
  });

  it('prints one blank page for a slip with no lines', () => {
    const pages = gridPages([]);
    expect(pages).toHaveLength(1);
    expect(pages[0].rows.every((r) => r.kind === 'blank')).toBe(true);
  });

  it('continues on a second page, marked as continued, when lines overflow', () => {
    const lines = Array.from({ length: GRID_ROWS_PER_PAGE + 2 }, (_, i) => line({ id: `l${i}` }));
    const pages = gridPages(lines);
    expect(pages).toHaveLength(2);
    expect(pages[0].rows.every((r) => r.kind === 'line')).toBe(true);
    expect(pages[1].continued).toBe(true);
    expect(pages[1].rows).toHaveLength(GRID_ROWS_PER_PAGE);
    expect(pages[1].rows.filter((r) => r.kind === 'line')).toHaveLength(2);
  });

  it('formats the item with its quantity and unit in brackets', () => {
    expect(gridPages([line()])[0].rows[0].item).toBe('Gate valve [GV-10] [2 pcs]');
  });

  it('prints blank rating and in-charge cells before rating, and the rating after', () => {
    const before = gridPages([line()])[0].rows[0];
    expect(before.whCheck).toBe('');
    expect(before.techCheck).toBe('');
    const after = gridPages([line({ whRating: 'gc', whInChargeName: 'Ana', techRating: 'na', techInChargeName: 'Ben' })])[0].rows[0];
    expect(after).toMatchObject({ whCheck: 'GC', whInCharge: 'Ana', techCheck: 'NA', techInCharge: 'Ben' });
  });
});

describe('stages', () => {
  it('strikes through a stage the slip does not have', () => {
    const vm = buildTransmittalViewModel(slip());
    expect(vm.stages.map((s) => s.present)).toEqual([true, false, false]);
  });

  it('keeps the Technical stage present on a slip that has it', () => {
    const vm = buildTransmittalViewModel(slip({ checkTechnical: true, stages: [] }));
    expect(vm.stages[2].present).toBe(true);
  });

  it('prints pictures Yes only when the signed stage holds evidence', () => {
    const signedStage = { id: 'st1', stage: 'warehouse_checking', completed_at: '2026-10-15T08:00:00Z' };
    const vm = buildTransmittalViewModel(slip({ stages: [signedStage], evidence: [{ id: 'e1', record_id: 'st1' }] }));
    expect(vm.stages[0].pictures).toBe('Yes');
    expect(buildTransmittalViewModel(slip({ stages: [signedStage] })).stages[0].pictures).toBe('No');
  });

  it('leaves pictures blank on a stage not yet signed', () => {
    const vm = buildTransmittalViewModel(slip());
    expect(vm.stages[0].pictures).toBe('');
    expect(vm.stages[1].pictures).toBe('');
  });
});

describe('signature plates', () => {
  it('leaves a waiting plate blank', () => {
    expect(plate('Received by', { waiting: true })).toEqual({ role: 'Received by', state: 'waiting', who: '', stamp: '' });
    expect(plate('Received by')).toMatchObject({ state: 'waiting' });
  });

  it('prints a signed plate with its name and stamp', () => {
    const p = plate('Released by', { who: 'Ana', at: '2026-10-15T08:00:00Z' });
    expect(p.state).toBe('signed');
    expect(p.who).toBe('Ana');
    expect(p.stamp).toMatch(/^signed /);
  });

  it('prints name only for an unconfirmed or declined co-signer', () => {
    const base = {
      stages: [{
        id: 'st1', stage: 'warehouse_checking', remarks: 'ok', first_signer: { name: 'Ana' }, first_signed_at: '2026-10-15T08:00:00Z',
        second_signer_name: 'Ben', second_signed_at: '2026-10-15T09:00:00Z', second_confirmed: false,
      }],
    };
    const unconfirmed = buildTransmittalViewModel(slip(base)).stages[0].plates[1];
    expect(unconfirmed.who).toBe('Ben');
    expect(unconfirmed.stamp).toContain('not yet confirmed');
    const declined = buildTransmittalViewModel(slip({
      stages: [{ ...base.stages[0], second_confirmed: false, second_signature_declined: true }],
    })).stages[0].plates[1];
    expect(declined.stamp).toContain('signature not applied');
  });

  it('prints name only for a first signatory not yet confirmed (the completer signed second)', () => {
    const vm = buildTransmittalViewModel(slip({
      stages: [{
        id: 'st1', stage: 'warehouse_checking', completed_at: '2026-10-15T09:00:00Z',
        first_signer: { name: 'Ana', signatureBase64: 'data:image/png;base64,AA' }, first_signed_at: '2026-10-15T09:00:00Z', first_confirmed: false,
        second_signer: { name: 'Ben', signatureBase64: 'data:image/png;base64,BB' }, second_signer_name: 'Ben',
        second_signed_at: '2026-10-15T09:00:00Z', second_confirmed: true,
      }],
    }));
    const [first, second] = vm.stages[0].plates;
    expect(first).toMatchObject({ who: 'Ana', signatureBase64: null });
    expect(first.stamp).toContain('not yet confirmed');
    expect(second).toMatchObject({ who: 'Ben', signatureBase64: 'data:image/png;base64,BB' });
  });

  it("prints a Check by signer's stored signature", () => {
    const vm = buildTransmittalViewModel(slip({
      checkBy: { first: { name: 'Cy', at: '2026-10-15T10:00:00Z', callSign: '1001', signatureBase64: 'data:image/png;base64,CC' }, second: null },
    }));
    expect(vm.checkBy[0].signatureBase64).toBe('data:image/png;base64,CC');
    expect(vm.checkBy[0].stamp).not.toContain('name only');
  });

  it('prints name only for a Check by signer who declined their signature', () => {
    const vm = buildTransmittalViewModel(slip({
      checkBy: {
        first: { name: 'Cy', at: '2026-10-15T10:00:00Z', callSign: '1001', signatureBase64: 'data:image/png;base64,CC', signatureDeclined: true },
        second: null,
      },
    }));
    expect(vm.checkBy[0]).toMatchObject({ state: 'signed', who: 'Cy', signatureBase64: null });
    expect(vm.checkBy[0].stamp).toContain('signature not applied');
  });

  it('leaves the Check by plates blank until signed', () => {
    const vm = buildTransmittalViewModel(slip());
    expect(vm.checkBy.every((p) => p.state === 'waiting')).toBe(true);
    const signed = buildTransmittalViewModel(slip({
      checkBy: { first: { name: 'Cy', at: '2026-10-15T10:00:00Z', callSign: '1001' }, second: null },
    }));
    expect(signed.checkBy[0]).toMatchObject({ state: 'signed', who: 'Cy', callSign: '1001' });
    expect(signed.checkBy[1].state).toBe('waiting');
  });
});

describe('buildTransmittalViewModel', () => {
  it('carries the header, legend and Odoo receipt', () => {
    const vm = buildTransmittalViewModel(slip({ odooReceiptRef: 'WH/IN/0042', odooReceivedBy: { name: 'Dee' } }));
    expect(vm.number).toBe('TG03-525');
    expect(vm.legend).toBe('GOOD CONDITION = GC · NEED ATTENTION = NA');
    expect(vm.odooReceived).toMatchObject({ by: 'Dee', ref: 'WH/IN/0042' });
    expect(vm.techBox).toBe(false);
  });
});
