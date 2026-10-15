import { describe, expect, it } from 'vitest';
import { buildTransmittalDocument } from './transmittalDocument';
import { GRID_ROWS_PER_PAGE, buildTransmittalViewModel } from './transmittalViewModel';

const base = {
  number: 'TG03-600',
  state: 'warehouse_checking',
  preparedOn: '2026-10-15',
  origin: 'purchasing',
  checkWarehouse: true,
  checkTechnical: false,
  priority: 'medium',
  entity: 'T3CK',
  products: [],
  references: [],
  lines: [],
  stages: [],
  evidence: [],
  checkBy: { first: null, second: null },
};

describe('buildTransmittalDocument', () => {
  it('escapes typed text and prints one sheet per grid page', () => {
    const lines = Array.from({ length: GRID_ROWS_PER_PAGE + 1 }, (_, i) => ({
      id: `l${i}`, description: i === 0 ? '<img src=x>' : 'Pump', quantity: 1, unit: 'pcs',
    }));
    const html = buildTransmittalDocument(buildTransmittalViewModel({ ...base, lines }));
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;img src=x&gt;');
    expect(html.match(/class="sheet tg-sheet"/g)).toHaveLength(2);
    expect(html).toContain('Continued from the previous page');
  });

  it('prints the stage sections and Check by on the last page', () => {
    const html = buildTransmittalDocument(buildTransmittalViewModel(base));
    expect(html).toContain('Warehouse: Checking Remarks');
    expect(html).toContain('tg-stage struck');
    expect(html).toContain('Check by (1)');
  });
});
