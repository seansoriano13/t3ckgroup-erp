import { describe, expect, it } from 'vitest';
import { buildCanvassViewModel, canPrintCanvass, signatureBlock, SUPPLIERS_PER_PAGE } from './canvassViewModel';
import { buildCanvassDocument } from './canvassDocument';

const lines = () => [
  { id: 'l1', name: 'Folding stretcher', description: 'Aluminium', brand: 'Ferno', quantity: 2, unit: 'pc' },
  { id: 'l2', name: 'Splint set', description: null, brand: null, quantity: 10, unit: 'set' },
  { id: 'l3', name: 'Trauma bag', description: null, brand: null, quantity: 1, unit: 'pc' },
];

const supplier = (n, extra = {}) => ({
  id: `s${n}`,
  supplier_name: `Supplier ${n}`,
  currency: 'PHP',
  valid_until: '2026-12-01',
  lead_time: `${n * 7} days`,
  comparison_rate: null,
  ...extra,
});

const quote = (s, item, price, extra = {}) => ({
  id: `q-${s}-${item}`,
  supplier_id: `s${s}`,
  item_id: `l${item}`,
  brand: `Brand ${s}`,
  description: `Offer ${s}/${item}`,
  remarks: null,
  unit_price: price,
  ...extra,
});

const canvass = (n, overrides = {}) => ({
  id: 'c1',
  number: 'CNV_0201',
  created_at: '2026-11-10T02:00:00Z',
  canReadMoney: true,
  suppliers: Array.from({ length: n }, (_, i) => supplier(i + 1)),
  quotes: [quote(1, 1, 1000), quote(2, 1, 900), quote(3, 1, 950), quote(1, 2, 50), quote(2, 2, 55)],
  winners: [{ item_id: 'l1', supplier_id: 's2', reason: 'Cheapest and in stock.' }],
  noOtherSupplier: null,
  ...overrides,
});

const build = (c, extra = {}) =>
  buildCanvassViewModel(
    { canvass: c, request: { number: 'PR-0042', title: 'Rescue kit', client: 'Capas', project: 'Rescue', sor: 'S07920' }, lines: lines(), people: { creator: { name: 'Ana Cruz' } }, ...extra },
    { printedAt: '2026-11-11T02:00:00Z', printedBy: 'Ana Cruz' },
  );

describe('buildCanvassViewModel paging', () => {
  it('puts three suppliers on one page', () => {
    const vm = build(canvass(3));
    expect(SUPPLIERS_PER_PAGE).toBe(3);
    expect(vm.pages).toHaveLength(1);
    expect(vm.pages[0].suppliers.map((s) => s.name)).toEqual(['Supplier 1', 'Supplier 2', 'Supplier 3']);
    expect(vm.pages[0].rows).toHaveLength(3);
    expect(vm.pages[0].rows[0].cells).toHaveLength(3);
  });

  it('continues five suppliers over two pages with the line column repeated', () => {
    const vm = build(canvass(5));
    expect(vm.pages).toHaveLength(2);
    expect(vm.pages.map((p) => p.suppliers.length)).toEqual([3, 2]);
    expect(vm.pages.map((p) => `${p.number}/${p.of}`)).toEqual(['1/2', '2/2']);
    for (const page of vm.pages) {
      expect(page.rows.map((r) => r.no)).toEqual([1, 2, 3]);
      expect(page.rows[0].description).toBe('Folding stretcher — Aluminium');
      expect(page.rows[0].brand).toBe('Ferno');
      expect(page.rows[0].quantity).toBe('2');
      expect(page.rows[0].unit).toBe('pc');
    }
  });

  it('still prints the line column when there is no supplier yet', () => {
    const vm = build(canvass(0, { quotes: [], winners: [] }));
    expect(vm.pages).toHaveLength(1);
    expect(vm.pages[0].rows).toHaveLength(3);
  });
});

describe('headings and cells', () => {
  it('shows currency, rate, how long the quote holds and lead time in the heading', () => {
    const c = canvass(3);
    c.suppliers[2] = supplier(3, { currency: 'USD', comparison_rate: 56.5625 });
    const head = build(c).pages[0].suppliers[2];
    expect(head.currency).toBe('USD');
    expect(head.rate).toBe('1 USD = PHP 56.5625');
    expect(head.holds).toMatch(/^Valid to Dec 1, 2026$/);
    expect(head.leadTime).toBe('21 days');
  });

  it('gives each quoted cell brand, description, price and total, and marks the line winner', () => {
    const cells = build(canvass(3)).pages[0].rows[0].cells;
    expect(cells[1]).toMatchObject({ state: 'quoted', winner: true, brand: 'Brand 2', description: 'Offer 2/1', price: 'PHP 900.00', total: 'PHP 1,800.00' });
    expect(cells[0].winner).toBe(false);
  });

  it('prints a dash for a quote with no price, never zero', () => {
    const c = canvass(3, { quotes: [quote(1, 1, null)], winners: [] });
    const cell = build(c).pages[0].rows[0].cells[0];
    expect(cell.price).toBe('—');
    expect(cell.total).toBe('—');
  });
});

describe('skipped lines', () => {
  it('says so for a line with no winner and a line nobody quoted', () => {
    const vm = build(canvass(3));
    expect(vm.reasons.map((r) => r.outcome)).toEqual(['won', 'no-winner', 'unquoted']);
    expect(vm.reasons[0]).toMatchObject({ supplier: 'Supplier 2', reason: 'Cheapest and in stock.' });
    expect(vm.pages[0].rows[2].cells.every((c) => c.state === 'none')).toBe(true);
    const html = buildCanvassDocument(vm);
    expect(html).toContain('No winner chosen');
    expect(html).toContain('No supplier quoted');
    expect(html).toContain('Not quoted');
  });

  it('prints the No other supplier note when there is one, and no under-three warning with it', () => {
    const withNote = build(canvass(2, { noOtherSupplier: { reason: 'Sole distributor.', created_at: '2026-11-10T02:00:00Z', actor: { name: 'Ana Cruz' } } }));
    expect(withNote.noOtherSupplier).toEqual({ reason: 'Sole distributor.', by: 'Ana Cruz · Nov 10, 2026' });
    expect(withNote.warning).toBeNull();
    expect(buildCanvassDocument(withNote)).toContain('Sole distributor.');

    const without = build(canvass(2));
    expect(without.noOtherSupplier).toBeNull();
    expect(without.warning).toMatch(/below the three-offer minimum/);
  });
});

describe('the sheet for a reader who may not see money', () => {
  const stripped = () => {
    const c = canvass(3);
    c.canReadMoney = false;
    c.suppliers = [supplier(1), supplier(2), supplier(3, { currency: 'USD' })];
    c.quotes = c.quotes.map((q) => ({ ...q, unit_price: undefined })).map((q) => { delete q.unit_price; return q; });
    return c;
  };

  it('carries no price, rate or total anywhere', () => {
    const vm = build(stripped());
    expect(vm.money).toBe(false);
    for (const row of vm.pages[0].rows) {
      for (const cell of row.cells) {
        expect(cell).not.toHaveProperty('price');
        expect(cell).not.toHaveProperty('total');
      }
    }
    for (const head of vm.pages[0].suppliers) expect(head).not.toHaveProperty('rate');
    const html = buildCanvassDocument(vm);
    expect(html).not.toMatch(/PHP \d|Total /);
    expect(html).toContain('Brand 1');
  });

  it('can still be printed', () => {
    expect(canPrintCanvass(stripped())).toBe(true);
  });
});

describe('header and signature', () => {
  it('names the number, request, client or project, date and Canvassed by', () => {
    const vm = build(canvass(3));
    expect(vm.number).toBe('CNV_0201');
    expect(vm.header).toMatchObject({ request: 'PR-0042 · Rescue kit', client: 'Capas', project: 'Rescue', date: 'Nov 10, 2026' });
    const html = buildCanvassDocument(vm);
    expect(html).toContain('Canvassed by');
    expect(html).toContain('Capas · Rescue');
  });

  it('has only the Canvassed by signature, no Check-by', () => {
    const vm = build(canvass(3));
    expect(vm.signatures.map((s) => s.role)).toEqual(['Canvassed by']);
    expect(buildCanvassDocument(vm)).not.toMatch(/Check(ed)? by/);
  });

  it('prints a name-only signer and a signer still waiting', () => {
    expect(signatureBlock('Canvassed by', 'Purchasing', { who: 'Ana', verb: 'canvassed' })).toMatchObject({ state: 'signed', signaturePath: null });
    expect(signatureBlock('Canvassed by', 'Purchasing', {})).toMatchObject({ state: 'awaiting' });
  });

  it('escapes typed text in the document', () => {
    const c = canvass(3);
    c.suppliers[0] = supplier(1, { supplier_name: '<script>x</script>' });
    expect(buildCanvassDocument(build(c))).not.toContain('<script>x</script>');
  });
});

describe('cancelled and bought lines', () => {
  const withStatus = (statuses) => lines().map((l, i) => ({ ...l, status: statuses[i] }));

  it('keeps a cancelled line on the sheet, marked, with no winner and not counted', () => {
    const c = canvass(3, { winners: [{ item_id: 'l1', supplier_id: 's2', reason: 'Left over.' }] });
    const vm = build(c, { lines: withStatus(['cancelled', 'to_purchase', 'to_purchase']) });
    expect(vm.pages[0].rows).toHaveLength(3);
    expect(vm.pages[0].rows[0]).toMatchObject({ no: 1, cancelled: true, outcome: 'cancelled' });
    expect(vm.pages[0].rows[0].cells.some((cell) => cell.winner)).toBe(false);
    expect(vm.reasons[0]).toMatchObject({ outcome: 'cancelled', supplier: null, reason: null });
    expect(vm.header.lineCount).toBe(2);
    const html = buildCanvassDocument(vm);
    expect(html).toContain('print-line-cancelled');
    expect(html).toContain('Cancelled');
  });

  it('says a bought line nobody quoted was bought with no Canvass', () => {
    const vm = build(canvass(3), { lines: withStatus(['to_purchase', 'to_purchase', 'purchased']) });
    expect(vm.reasons[2].outcome).toBe('bought-no-canvass');
    const html = buildCanvassDocument(vm);
    expect(html).toContain('Bought with no Canvass');
    expect(html.match(/Bought with no Canvass/g)).toHaveLength(2); // on the line and under the grid
  });
});
