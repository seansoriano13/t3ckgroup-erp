import { describe, it, expect } from 'vitest';
import { buildQuadDocument } from './quadPrototype';
import { buildPrintableDocument } from './htmlPrinter';

const form = (n) => ({
  recordNo: 'LV-' + n, formLabel: 'TG-11', kind: 'Leave', name: 'A B', meta: 'm', company: 'C',
  bigK: 'Days', bigN: '1', bigU: 'day', ledger: '', fields: [{ k: 'a', v: 'b' }], remK: 'Reason', rem: 'long '.repeat(300),
  hrd: [['x', 'y']], sigs: [], qrDataUrl: 'data:,', qrText: 'q', note: 'n',
});

describe('quad prototype', () => {
  it('puts five forms on two pages with cut lines and leaves the current print alone', () => {
    const data = [1, 2, 3, 4, 5].map(form);
    const html = buildQuadDocument(data);
    expect((html.match(/class="paper quad"/g) || []).length).toBe(2);
    expect((html.match(/class="hline"/g) || []).length).toBe(2);
    expect(html).toContain('long long');
    expect(buildPrintableDocument(data)).not.toContain('quad');
  });
});
