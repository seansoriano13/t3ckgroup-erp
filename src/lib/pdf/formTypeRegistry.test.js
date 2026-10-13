import { describe, it, expect } from 'vitest';
import { getFormType } from './formTypeRegistry';
import { buildTG11ViewModel, buildTG12ViewModel, buildTG13ViewModel } from './formViewModel';
import { buildIpasViewModel } from './ipasViewModel';

describe('getFormType', () => {
  it('resolves SIL and OFFSET to the TG-11 builder', () => {
    expect(getFormType('SIL').buildViewModel).toBe(buildTG11ViewModel);
    expect(getFormType('OFFSET').buildViewModel).toBe(buildTG11ViewModel);
  });

  it('resolves OVERTIME to the TG-12 builder', () => {
    expect(getFormType('OVERTIME').buildViewModel).toBe(buildTG12ViewModel);
  });

  it('resolves UNDERTIME to the TG-13 builder', () => {
    expect(getFormType('UNDERTIME').buildViewModel).toBe(buildTG13ViewModel);
  });

  it('resolves IPAS to its own view model builder', () => {
    expect(getFormType('IPAS').buildViewModel).toBe(buildIpasViewModel);
  });

  it('stamps nothing when an IPAS is printed', async () => {
    await expect(getFormType('IPAS').markPrinted({ id: 'ipas-1' }, 'hr-1')).resolves.toBeUndefined();
  });

  it('fails loudly on an unknown record type rather than defaulting to a leave form', () => {
    expect(() => getFormType('SOMETHING_ELSE')).toThrow(/unknown form record type/i);
  });

  it('gives every known type a markPrinted action', () => {
    for (const type of ['SIL', 'OFFSET', 'OVERTIME', 'UNDERTIME', 'IPAS']) {
      expect(typeof getFormType(type).markPrinted).toBe('function');
    }
  });
});
