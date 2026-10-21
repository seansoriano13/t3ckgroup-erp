import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYERS, ENTRY_KINDS, LAYERS, kindOf, layerOf, visibleEntries } from './entryKinds.jsx';

describe('entry-kind registry', () => {
  it('maps each kind to its layer', () => {
    expect(layerOf('SIL')).toBe('timeOff');
    expect(layerOf('OFFSET')).toBe('timeOff');
    expect(layerOf('UNDERTIME')).toBe('timeOff');
    expect(layerOf('OVERTIME')).toBe('overtime');
  });

  it('only points at layers that exist, and gives every kind a label, icon and colours', () => {
    const layerKeys = LAYERS.map((l) => l.key);
    for (const def of Object.values(ENTRY_KINDS)) {
      expect(layerKeys).toContain(def.layer);
      expect(def.label).toBeTruthy();
      expect(def.icon).toBeTruthy();
      expect(def.chip).toBeTruthy();
    }
  });

  it('has the three layers, Meetings included', () => {
    expect(LAYERS.map((l) => l.label)).toEqual(['Meetings', 'Time Off', 'Overtime']);
  });

  it('does not know a kind it was not given', () => {
    expect(kindOf('HOLIDAY')).toBeNull();
    expect(layerOf('HOLIDAY')).toBeNull();
  });

  it('hides entries of a layer that is off and skips unknown kinds', () => {
    const entries = [{ kind: 'SIL' }, { kind: 'OVERTIME' }, { kind: 'HOLIDAY' }];
    expect(visibleEntries(entries, DEFAULT_LAYERS).map((e) => e.kind)).toEqual(['SIL', 'OVERTIME']);
    expect(visibleEntries(entries, { ...DEFAULT_LAYERS, overtime: false }).map((e) => e.kind)).toEqual(['SIL']);
  });
});
