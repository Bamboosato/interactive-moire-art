import { describe, expect, it } from 'vitest';
import { fbm3D, valueNoise3D } from './noise';

describe('continuous seeded noise', () => {
  it('returns deterministic bounded values for a fixed seed', () => {
    const first = valueNoise3D(1.25, -0.4, 0.75, 215);
    expect(valueNoise3D(1.25, -0.4, 0.75, 215)).toBe(first);
    expect(first).toBeGreaterThanOrEqual(-1);
    expect(first).toBeLessThanOrEqual(1);

    const field = fbm3D(0.12, 0.34, 0.56, 215, 4);
    expect(field).toBeGreaterThanOrEqual(-1);
    expect(field).toBeLessThanOrEqual(1);
    expect(fbm3D(0.12, 0.34, 0.56, 216, 4)).not.toBe(field);
  });

  it('changes smoothly between nearby coordinates', () => {
    const first = fbm3D(2.1, 3.2, 4.3, 1234567890, 4);
    const nearby = fbm3D(2.101, 3.201, 4.301, 1234567890, 4);
    expect(Math.abs(nearby - first)).toBeLessThan(0.1);
  });
});
