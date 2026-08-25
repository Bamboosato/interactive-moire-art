import { describe, expect, it } from 'vitest';
import { getBuiltInPresets, makePresetRecord } from './presets';
import { DEFAULT_SETTINGS } from '../constants';

describe('presets', () => {
  it('provides valid English built-in presets without mutable shared settings', () => {
    const first = getBuiltInPresets();
    const second = getBuiltInPresets();
    expect(first.length).toBeGreaterThanOrEqual(4);
    expect(first.every((preset) => preset.builtIn && preset.name.length > 0)).toBe(true);
    const dotmatrix = first.find((preset) => preset.id === 'builtin-dotmatrix-interpolation');
    expect(dotmatrix?.settings.mode).toBe('hybrid');
    expect(dotmatrix?.settings.randomSeed).toBe(215);
    first[0].settings.lineSpacing = 8;
    expect(second[0].settings.lineSpacing).toBe(DEFAULT_SETTINGS.lineSpacing);
  });

  it('creates a custom preset snapshot with stable identity fields', () => {
    const record = makePresetRecord('Test preset', DEFAULT_SETTINGS, 1234, 'preset-1');
    expect(record).toMatchObject({ id: 'preset-1', name: 'Test preset', builtIn: false, createdAt: 1234, updatedAt: 1234 });
    expect(record.layers).not.toBe(DEFAULT_SETTINGS.layers);
  });
});
