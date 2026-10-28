import { describe, expect, it } from 'vitest';
import { buildCanvassViewModel, canPrintCanvass, offerGroups, signatureBlock, subjectLine } from './canvassViewModel';
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

describe('side-by-side comparison (purchasing feedback 2026-10-20)', () => {
  const many = (n) =>
    Array.from({ length: n }, (_, i) => ({
      ...offers()[1],
      id: `m${i + 1}`,
      supplier_name: `Supplier ${i + 1}`,
      quality_note: i === 0 ? 'ISO 13485' : null,
      is_winner: i === 1,
    }));

  it('puts the suppliers in columns and the details in rows, the chosen column marked', () => {
    const html = buildCanvassDocument(build());
    const head = html.slice(html.indexOf('<table class="cnv-compare">'), html.indexOf('</thead>'));
    expect(head.indexOf('Redleaf Medical Supplies')).toBeLessThan(head.indexOf('MedSupply PH'));
    expect(head.indexOf('MedSupply PH')).toBeLessThan(head.indexOf('Dragon Safety HK'));
    expect(head).toContain('Chosen');
    for (const label of ['Offered', 'Quoted', 'In PHP', 'Lead time', 'Quality', 'Valid to', 'Brochure', 'Remarks']) {
      expect(html).toContain(`scope="row">${label}</th>`);
    }
    expect((html.match(/<table class="cnv-compare">/g) ?? [])).toHaveLength(1);
  });

  it('prints the quality note, and a dash where there is none', () => {
    const vm = build(canvass({ offers: many(2) }));
    expect(vm.offers.map((o) => o.quality)).toEqual(['ISO 13485', '—']);
  });

  it('keeps up to four suppliers in one table', () => {
    const vm = build(canvass({ offers: many(4) }));
    expect(vm.offerGroups).toHaveLength(1);
    expect(vm.offerGroups[0].label).toBeNull();
  });

  it('continues past four suppliers in a second table under the same rows, columns kept in line', () => {
    const vm = build(canvass({ offers: many(7) }));
    expect(vm.offerGroups.map((g) => g.offers.map((o) => o.supplier))).toEqual([
      ['Supplier 1', 'Supplier 2', 'Supplier 3', 'Supplier 4'],
      ['Supplier 5', 'Supplier 6', 'Supplier 7'],
    ]);
    expect(vm.offerGroups.map((g) => g.label)).toEqual(['Offers 1–4 of 7', 'Offers 5–7 of 7']);

    const html = buildCanvassDocument(vm);
    expect((html.match(/<table class="cnv-compare">/g) ?? [])).toHaveLength(2);
    expect(html).toContain('Offers 5–7 of 7');
    // The short second table is padded to four columns so it lines up with the first.
    const second = html.slice(html.lastIndexOf('<table class="cnv-compare">'));
    expect((second.slice(0, second.indexOf('</thead>')).match(/cnv-pad/g) ?? [])).toHaveLength(1);
  });

  it('labels a lone fifth supplier as one Offer', () => {
    expect(offerGroups(many(5).map((o) => ({ supplier: o.supplier_name })), 4)[1].label).toBe('Offers 5 of 5');
  });
});

describe('a Canvass with no subject yet (ADR 0034)', () => {
  it('prints the product as the subject', () => {
    const vm = buildCanvassViewModel({ canvass: canvass(), subject: { product: { name: 'Laser printer toner' } }, people: { creator } });
    expect(vm.header).toMatchObject({ subjectKind: 'Product', subject: 'Laser printer toner' });
    expect(buildCanvassDocument(vm)).toContain('Laser printer toner');
  });
});

describe('the supplier slots on paper (#721)', () => {
  const mark = (slot, reason) => ({ slot, reason, created_at: '2026-11-13T02:00:00Z', actor: { name: 'Ben Cruz' } });
  const withOne = () => ({ ...canvass(), offers: offers().slice(0, 1) });

  it('prints the three slots: the supplier, then No other supplier with its reason and who, then Not filled', () => {
    const vm = buildCanvassViewModel({
      canvass: { ...withOne(), noOtherSupplier: [mark(2, 'Sole distributor')] },
      subject: { product: { name: 'Toner' } },
      people: { creator },
    });
    expect(vm.slots.map((s) => s.kind)).toEqual(['offer', 'none', 'empty']);
    expect(vm.slots[0].label).toBe('Redleaf Medical Supplies');
    expect(vm.slots[1]).toMatchObject({ label: 'No other supplier', reason: 'Sole distributor' });
    expect(vm.slots[1].by).toContain('Ben Cruz');
    const html = buildCanvassDocument(vm);
    expect(html).toContain('Sole distributor');
    expect(html).toContain('Not filled');
  });

  it('prints one reason under both slots when it serves both', () => {
    const vm = buildCanvassViewModel({
      canvass: { ...withOne(), noOtherSupplier: [mark(2, 'Only dealer'), mark(3, 'Only dealer')] },
      subject: { product: { name: 'Toner' } },
      people: { creator },
    });
    expect(vm.slots.filter((s) => s.reason === 'Only dealer')).toHaveLength(2);
    expect(vm.warning).toBeNull();
  });
});
