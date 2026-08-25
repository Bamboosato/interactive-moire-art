import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../constants';
import {
  cloneSettings,
  normalizeSettings,
  randomizeSettings,
  settingsEqual,
  validatePresetName,
} from './validation';

describe('settings validation', () => {
  it('clamps all public numeric parameters at their supported boundaries', () => {
    const result = normalizeSettings({
      mode: 'dot', lineSpacing: -1, thickness: 99, noiseStrength: -4, noiseScale: 99,
      interactionStrength: -1, influenceRadius: 999, speed: 9, randomSeed: 9_999_999_999,
      layers: { c: { visible: true } },
    });
    expect(result.mode).toBe('dot');
    expect(result.lineSpacing).toBe(2);
    expect(result.thickness).toBe(1.6);
    expect(result.noiseStrength).toBe(0);
    expect(result.noiseScale).toBe(0.012);
    expect(result.interactionStrength).toBe(0);
    expect(result.influenceRadius).toBe(400);
    expect(result.speed).toBe(1);
    expect(result.randomSeed).toBe(4_294_967_295);
    expect(result.layers.c).toEqual({ visible: true });
  });

  it('falls back for invalid, missing, or non-finite persisted values', () => {
    const result = normalizeSettings({ mode: 'unknown', lineSpacing: Number.NaN, speed: Infinity, layers: null });
    expect(result.mode).toBe(DEFAULT_SETTINGS.mode);
    expect(result.lineSpacing).toBe(DEFAULT_SETTINGS.lineSpacing);
    expect(result.speed).toBe(DEFAULT_SETTINGS.speed);
    expect(result.layers.k).toEqual(DEFAULT_SETTINGS.layers.k);
  });

  it('migrates the v1 line model into the v2 flow-line model', () => {
    const result = normalizeSettings({
      mode: 'line', period: 14, thickness: 1.4, distortion: 48, speed: 0.25,
      layers: { c: { visible: false, angleOffset: -20, phase: 2 } },
    });
    expect(result.mode).toBe('flowline');
    expect(result.lineSpacing).toBe(3.5);
    expect(result.thickness).toBeCloseTo(0.798);
    expect(result.noiseStrength).toBe(28);
    expect(result.interactionStrength).toBeCloseTo(52);
    expect(result.noiseScale).toBe(DEFAULT_SETTINGS.noiseScale);
    expect(result.layers.c).toEqual({ visible: false });
  });

  it('validates preset names by trimmed Unicode code-point length', () => {
    expect(validatePresetName('   Evening   ')).toEqual({ valid: true, name: 'Evening' });
    expect(validatePresetName('')).toEqual({ valid: false, message: expect.any(String) });
    expect(validatePresetName('😀'.repeat(64)).valid).toBe(true);
    expect(validatePresetName('😀'.repeat(65)).valid).toBe(false);
  });

  it('detects setting changes without treating object identity as state', () => {
    const copy = cloneSettings(DEFAULT_SETTINGS);
    expect(settingsEqual(DEFAULT_SETTINGS, copy)).toBe(true);
    copy.layers.m.visible = false;
    expect(settingsEqual(DEFAULT_SETTINGS, copy)).toBe(false);
  });

  it('generates values within the randomization ranges and preserves the static layer profile', () => {
    const result = randomizeSettings(() => 0.5);
    expect(result.mode).toBe('dot');
    expect(result.lineSpacing).toBe(3.5);
    expect(result.thickness).toBe(0.4);
    expect(result.noiseStrength).toBe(32);
    expect(result.noiseScale).toBe(0.0053);
    expect(result.interactionStrength).toBe(55);
    expect(result.influenceRadius).toBe(160);
    expect(result.speed).toBe(0.33);
    expect(result.randomSeed).toBe(2_147_483_648);
    expect(result.layers.c).toEqual(DEFAULT_SETTINGS.layers.c);
  });
});
