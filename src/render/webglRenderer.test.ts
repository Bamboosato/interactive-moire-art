import { describe, expect, it } from 'vitest';
import {
  FRAGMENT_SHADER_SOURCE,
  PRESENT_FRAGMENT_SHADER_SOURCE,
  VERTEX_SHADER_SOURCE,
  calculateInternalRenderSize,
  flipRgbaRows,
} from './webglRenderer';

describe('WebGL renderer helpers', () => {
  it('keeps the internal framebuffer within the configured limits', () => {
    const fullQuality = calculateInternalRenderSize(1920, 1080, 3, 1);
    const lowQuality = calculateInternalRenderSize(1920, 1080, 3, 0.5);
    const oversized = calculateInternalRenderSize(1_000_000, 100, 3, 1);

    expect(fullQuality.width).toBeLessThanOrEqual(4096);
    expect(fullQuality.height).toBeLessThanOrEqual(4096);
    expect(fullQuality.width * fullQuality.height).toBeLessThanOrEqual(4_194_304);
    expect(lowQuality.width).toBeLessThan(fullQuality.width);
    expect(lowQuality.height).toBeLessThan(fullQuality.height);
    expect(oversized.width).toBeLessThanOrEqual(4096);
    expect(oversized.height).toBeLessThanOrEqual(4096);
    expect(oversized.width * oversized.height).toBeLessThanOrEqual(4_194_304);
  });

  it('normalizes invalid dimensions and quality inputs to safe render sizes', () => {
    const size = calculateInternalRenderSize(Number.NaN, -20, Number.NaN, Number.NaN);

    expect(size.width).toBe(1);
    expect(size.height).toBe(1);
    expect(Number.isFinite(size.scale)).toBe(true);
  });

  it('flips WebGL bottom-up rows for Canvas 2D output', () => {
    const source = new Uint8Array([
      1, 2, 3, 4,
      5, 6, 7, 8,
    ]);

    expect(Array.from(flipRgbaRows(source, 1, 2))).toEqual([
      5, 6, 7, 8,
      1, 2, 3, 4,
    ]);
  });

  it('uses GLSL ES 3.00 fullscreen shaders', () => {
    expect(VERTEX_SHADER_SOURCE).toContain('#version 300 es');
    expect(FRAGMENT_SHADER_SOURCE).toContain('#version 300 es');
    expect(FRAGMENT_SHADER_SOURCE).toContain('fwidth');
    expect(FRAGMENT_SHADER_SOURCE).toContain('fbm3D');
    expect(FRAGMENT_SHADER_SOURCE).toContain('fourthOctaveWeight');
    expect(FRAGMENT_SHADER_SOURCE).toContain('uLayerVisible');
    expect(FRAGMENT_SHADER_SOURCE).toContain('uPointerStrength');
    expect(FRAGMENT_SHADER_SOURCE).toContain('uTime * 0.18');
    expect(FRAGMENT_SHADER_SOURCE).toContain('uLayerProfile[4]');
    expect(FRAGMENT_SHADER_SOURCE).toContain('uLayerDisplacement[4]');
    expect(FRAGMENT_SHADER_SOURCE).toContain('flowDisplacement');
    expect(FRAGMENT_SHADER_SOURCE).toContain('profile.xy');
    expect(FRAGMENT_SHADER_SOURCE).not.toContain('uInterferencePoints[8]');
    expect(FRAGMENT_SHADER_SOURCE).not.toContain('commonDisplacement');
    expect(FRAGMENT_SHADER_SOURCE).not.toContain('kModulation');
    expect(PRESENT_FRAGMENT_SHADER_SOURCE).toContain('uPreviousTexture');
    expect(PRESENT_FRAGMENT_SHADER_SOURCE).toContain('mix(previous, current');
  });
});
