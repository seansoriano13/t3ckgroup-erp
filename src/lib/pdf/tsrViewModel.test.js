import { describe, expect, it } from 'vitest';
import { buildTsrViewModel, evidenceSummary, failureFooter, formatDuration, tsrPlate } from './tsrViewModel';
import { buildTsrSheetHtml } from './tsrDocument';

const tsr = (overrides = {}) => ({
  number: 'TSR_0007',
  item: 'Gate valve',
  transmittal: { number: 'TG03-525' },
  line: { position: 2, description: 'Gate valve [GV-10]' },
  sor: 'SOR-1',
  po: 'PO-99',
  units: [
    { serial: 'SN-1', verdict: 'pass', remark: '' },
    { serial: 'SN-2', verdict: 'fail', remark: 'Seat leaks under 6 bar, returned to vendor' },
  ],
  evidence: [
    { id: 'e1', kind: 'picture', storagePath: 'a.jpg', fileName: 'a.jpg' },
    { id: 'e2', kind: 'picture', storagePath: 'b.jpg', fileName: 'b.jpg' },
    { id: 'e3', kind: 'video', storagePath: 'v.mp4', fileName: 'v.mp4', durationSec: 42 },
  ],
  checkedBy: { name: 'Ana', at: '2026-10-15T08:00:00Z' },
  notedBy: null,
  ...overrides,
});

describe('evidence summary', () => {
  it('names the photographs and the video with its length, not the files', () => {
    expect(evidenceSummary(tsr().evidence)).toBe('2 photographs, 1 video (00:42), held in the ERP');
  });

  it('uses the singular and drops the length when there is none', () => {
    expect(evidenceSummary([{ kind: 'picture' }])).toBe('1 photograph, held in the ERP');
    expect(evidenceSummary([{ kind: 'video' }, { kind: 'video' }])).toBe('2 videos, held in the ERP');
  });

  it('says so when nothing is held', () => {
    expect(evidenceSummary([])).toBe('No photographs or videos held');
  });
});

describe('formatDuration', () => {
  it('reads seconds as m:ss, and h:mm:ss past an hour', () => {
    expect(formatDuration(42)).toBe('00:42');
    expect(formatDuration(3725)).toBe('1:02:05');
  });
});

describe('failure footer', () => {
  it('counts failed units of the total', () => {
    expect(failureFooter(tsr().units)).toBe('1 unit failed of 2');
  });

  it('prints no failure line when every unit passed', () => {
    expect(failureFooter([{ verdict: 'pass' }, { verdict: 'pass' }])).toBeNull();
  });
});

describe('units', () => {
  it('prints a failed unit with its full remark', () => {
    const vm = buildTsrViewModel(tsr());
    expect(vm.units[1]).toMatchObject({ verdict: 'Fail', failed: true, remark: 'Seat leaks under 6 bar, returned to vendor' });
    expect(vm.units[0]).toMatchObject({ verdict: 'Pass', failed: false });
  });
});

describe('signature states', () => {
  it('leaves an unsigned plate blank', () => {
    expect(tsrPlate('Checked by')).toEqual({ role: 'Checked by', state: 'waiting', who: '', stamp: '' });
  });

  it('prints a signed plate with name and stamp', () => {
    const vm = buildTsrViewModel(tsr());
    expect(vm.signatures.checkedBy).toMatchObject({ state: 'signed', who: 'Ana' });
    expect(vm.signatures.checkedBy.stamp).toMatch(/^signed /);
    expect(vm.signatures.notedBy).toBeNull();
  });

  it('prints the optional Noted by plate when purchasing has noted the TSR', () => {
    const vm = buildTsrViewModel(tsr({ notedBy: { name: 'Pat', at: null } }));
    expect(vm.signatures.notedBy).toEqual({ role: 'Noted by', state: 'waiting', who: '', stamp: '' });
    const signed = buildTsrViewModel(tsr({ notedBy: { name: 'Pat', at: '2026-10-15T09:00:00Z' } }));
    expect(signed.signatures.notedBy).toMatchObject({ state: 'signed', who: 'Pat' });
  });
});

describe('sheet html', () => {
  it('names the evidence and embeds no images by default', () => {
    const html = buildTsrSheetHtml(buildTsrViewModel(tsr()));
    expect(html).toContain('2 photographs, 1 video (00:42), held in the ERP');
    expect(html).not.toContain('<img');
  });

  it('embeds the pictures passed in when printing with photographs, and never a video', () => {
    const html = buildTsrSheetHtml(buildTsrViewModel(tsr()), {
      withPhotographs: true,
      photos: [{ src: 'data:image/jpeg;base64,AAA', fileName: 'a.jpg' }],
    });
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).not.toContain('v.mp4');
  });
});
