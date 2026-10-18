import { describe, expect, it } from 'vitest';
import { buildCanvassViewModel, canPrintCanvass, signatureBlock, subjectLine } from './canvassViewModel';
import { buildCanvassDocument } from './canvassDocument';

// The CNV_0142 sample from the prototype: three Offers against one Component, one of them in USD.
const offers = () => [
  {
    id: 'o1',
    supplier_name: 'Redleaf Medical Supplies',
    brand: 'Redleaf',
    description: 'Aluminium folding stretcher, 1,900 x 550 mm, restraint straps.',
    remarks: '1,900 mm against 2,000 mm. Deviation recorded.',
    currency: 'PHP',
    unit_price: 78000,
    comparison_rate: null,
    lead_time: '14 days',
    valid_until: '2026-09-30',
    brochure: [{ name: 'RL-FS190.pdf', url: 'x' }],
    is_winner: true,
  },
  {
    id: 'o2',
    supplier_name: 'MedSupply PH',
    brand: 'Ferno',
    description: 'Aluminium folding stretcher, 2,010 x 560 mm.',
    currency: 'PHP',
    unit_price: 82500,
    lead_time: '7 days',
    valid_until: '2026-09-25',
    brochure: [{ name: 'ferno-2000a.pdf', url: 'y' }],
    is_winner: false,
  },
  {
    id: 'o3',
    supplier_name: 'Dragon Safety HK',
    brand: 'Dragon',
    description: 'Aluminium folding stretcher, 2,000 x 550 mm, straps extra.',
    currency: 'USD',
    unit_price: 1280,
    comparison_rate: 56.5625,
    lead_time: '45 days',
    valid_until: '2026-09-18',
    brochure: [],
    is_winner: false,
  },
];

const canvass = (overrides = {}) => ({
  id: 'c1',
  number: 'CNV_0142',
  reason: 'Chosen on delivery and history rather than price.',
  created_at: '2026-09-11T02:00:00Z',
  created_by: 'e1',
  signed_off_at: null,
  signed_off_by: null,
  canReadMoney: true,
  offers: offers(),
  ...overrides,
});

const subject = { sor: 'S07983', component: { number: '1.2', name: 'Ambulance Folding Stretcher' } };
const creator = { name: 'J. Bautista', signaturePath: 'e1/sig.png' };

const build = (c = canvass(), people = { creator }) => buildCanvassViewModel({ canvass: c, subject, people }, { printedAt: '2026-09-15T02:00:00Z' });

describe('header', () => {
  it('carries the CNV number and the SOR and Component', () => {
    const vm = build();
    expect(vm.number).toBe('CNV_0142');
    expect(vm.header.subject).toBe('S07983 · 1.2 Ambulance Folding Stretcher');
  });

  it('names a Requested Item when there is no Component', () => {
    expect(subjectLine({ sor: 'S07983', requestedItem: { name: 'Nitrile gloves' } })).toBe('S07983 · Requested Item · Nitrile gloves');
    expect(subjectLine({ requestedItem: { name: 'Nitrile gloves' } })).toBe('Requested Item · Nitrile gloves');
  });
});

describe('decision block', () => {
  it('leads with the chosen supplier, brand, lead time, validity, price and the reason as written', () => {
    const { decision } = build();
    expect(decision.chosen).toBe(true);
    expect(decision.supplier).toBe('Redleaf Medical Supplies');
    expect(decision.detail).toBe('Redleaf · lead time 14 days · quote valid to Sep 30, 2026');
    expect(decision.price).toBe('PHP 78,000.00');
    expect(decision.foreign).toBeNull();
    expect(decision.reason).toBe('Chosen on delivery and history rather than price.');
  });

  it('prints the quoted currency large with the PHP figure and rate beneath when the winner is foreign', () => {
    const c = canvass({ offers: offers().map((o) => ({ ...o, is_winner: o.id === 'o3' })) });
    const { decision } = build(c);
    expect(decision.price).toBe('USD 1,280.00');
    expect(decision.foreign).toBe('≈ PHP 72,400.00 at 56.5625');
  });

  it('says so when no Offer is chosen yet', () => {
    const c = canvass({ offers: offers().map((o) => ({ ...o, is_winner: false })) });
    const { decision } = build(c);
    expect(decision.chosen).toBe(false);
    expect(decision.price).toBeNull();
  });
});

describe('offer table', () => {
  it('has a row per Offer with Redleaf marked chosen', () => {
    const { offers: rows } = build();
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => [r.supplier, r.chosen])).toEqual([
      ['Redleaf Medical Supplies', true],
      ['MedSupply PH', false],
      ['Dragon Safety HK', false],
    ]);
  });

  it('shows the USD Offer as quoted, with its PHP figure and rate', () => {
    const usd = build().offers[2];
    expect(usd.quoted).toBe('USD 1,280.00');
    expect(usd.php).toBe('PHP 72,400.00');
    expect(usd.foreign).toBe('≈ PHP 72,400.00 at 56.5625');
    expect(usd.leadTime).toBe('45 days');
    expect(usd.validUntil).toBe('Sep 18, 2026');
  });

  it('flags a missing brochure and a foreign Offer with no rate, never printing zero', () => {
    const c = canvass({ offers: [{ ...offers()[2], comparison_rate: null }, ...offers().slice(0, 2)] });
    const [noRate, , ] = build(c).offers;
    expect(noRate.brochure).toBeNull();
    expect(noRate.php).toBe('—');
    expect(noRate.foreign).toBe('no comparison rate recorded');
  });
});

describe('under three Offers', () => {
  it('prints no warning with three Offers', () => {
    expect(build().warning).toBeNull();
  });

  it('prints the two-offer warning line and still builds the sheet', () => {
    const c = canvass({ offers: offers().slice(0, 2) });
    const vm = build(c);
    expect(vm.warning).toBe('Two offers only — below the three-offer minimum');
    const html = buildCanvassDocument(vm);
    expect(html).toContain('Two offers only — below the three-offer minimum');
    expect(html.indexOf('Two offers only')).toBeLessThan(html.indexOf('Canvassed by'));
  });
});

describe('signatures', () => {
  it('prints Signature required for a block nobody has signed', () => {
    const vm = build();
    const approved = vm.signatures.find((s) => s.role === 'Approved by');
    expect(approved.state).toBe('awaiting');
    const checked = vm.signatures.find((s) => s.role === 'Checked by');
    expect(checked.state).toBe('awaiting');
    const html = buildCanvassDocument(vm);
    expect(html.match(/Signature required/g)).toHaveLength(2);
  });

  it('uses the stored signature when there is one, and the name only when there is not', () => {
    const c = canvass({ signed_off_at: '2026-09-14T03:00:00Z', signed_off_by: 'e2', signer: { name: 'A. Dela Cruz' } });
    const vm = build(c, { creator, approver: { name: 'A. Dela Cruz', signaturePath: null } });
    const [canvassed, , approved] = vm.signatures;
    expect(canvassed).toMatchObject({ state: 'signed', who: 'J. Bautista', signaturePath: 'e1/sig.png' });
    expect(approved).toMatchObject({ state: 'signed', who: 'A. Dela Cruz', signaturePath: null });
    expect(approved.stamp).toBe('e-signed Sep 14, 2026 · name only, no signature on file');

    canvassed.signatureBase64 = 'data:image/png;base64,AAA';
    const html = buildCanvassDocument(vm);
    expect(html).toContain('<img src="data:image/png;base64,AAA" />');
    expect(html).toContain('<div class="printed-name">A. Dela Cruz</div>');
  });

  it('falls back to the signer on the Canvass row when no people are handed over', () => {
    const c = canvass({ signed_off_at: '2026-09-14T03:00:00Z', signer: { name: 'A. Dela Cruz' } });
    expect(build(c, {}).signatures[2]).toMatchObject({ state: 'signed', who: 'A. Dela Cruz' });
  });

  it('builds a plain awaiting block when there is no name', () => {
    expect(signatureBlock('Checked by', 'Purchasing', {})).toMatchObject({ state: 'awaiting', who: '' });
  });
});

describe('money tier', () => {
  it('offers the print only to a reader whose Canvass carries the money', () => {
    expect(canPrintCanvass(canvass())).toBe(true);
    expect(canPrintCanvass(canvass({ canReadMoney: false }))).toBe(false);
    expect(canPrintCanvass(null)).toBe(false);
  });

  it('never invents a figure for Offers that arrived with no price keys', () => {
    const bare = offers().map((o) => ({ ...o, unit_price: undefined, comparison_rate: undefined }));
    const vm = build(canvass({ canReadMoney: false, offers: bare }));
    expect(vm.offers.every((o) => o.quoted === '—' && o.php === '—')).toBe(true);
    expect(vm.decision.price).toBe('—');
  });
});

describe('document', () => {
  it('escapes what was typed', () => {
    const c = canvass({ reason: '<b>cheap</b> & fast' });
    const html = buildCanvassDocument(build(c));
    expect(html).toContain('&lt;b&gt;cheap&lt;/b&gt; &amp; fast');
    expect(html).toContain('A4 portrait');
  });
});
