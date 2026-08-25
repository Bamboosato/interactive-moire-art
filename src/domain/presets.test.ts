import { describe, expect, it } from 'vitest';
import { getBuiltInPresets, makePresetRecord } from './presets';
import { BUILT_IN_PRESETS, DEFAULT_SETTINGS, LAYER_DEFINITIONS } from '../constants';

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

  it('keeps the fixed CMYK registration offsets within the visual separation budget', () => {
    const profiles = Object.values(LAYER_DEFINITIONS);
    const maximumOffset = Math.max(...profiles.flatMap((profile) => [Math.abs(profile.offsetX), Math.abs(profile.offsetY)]));

    expect(maximumOffset).toBeLessThanOrEqual(0.3);
  });

  it('uses a conservative Ink Bloom profile for dense dot rendering', () => {
    const inkBloom = BUILT_IN_PRESETS.find((preset) => preset.id === 'builtin-ink-bloom');

    expect(inkBloom?.overrides).toMatchObject({
      lineSpacing: 3,
      thickness: 0.9,
      noiseStrength: 32,
      noiseScale: 0.005,
      interactionStrength: 54,
      influenceRadius: 150,
      speed: 0.24,
      mode: 'dot',
    });
  });
});
