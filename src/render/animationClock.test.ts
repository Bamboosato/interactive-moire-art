import { describe, expect, it } from 'vitest';
import { advanceElapsedTime } from './animationClock';

describe('animation clock', () => {
  it('keeps the shader time continuous when crossing a 2π boundary', () => {
    const boundary = Math.PI * 2;
    const next = advanceElapsedTime(boundary - 0.01, 0.35, 100);

    expect(next).toBeCloseTo(boundary + 0.025, 8);
  });

  it('ignores invalid timing inputs without introducing a jump', () => {
    expect(advanceElapsedTime(Number.NaN, 0.35, 16)).toBeCloseTo(0.0056, 8);
    expect(advanceElapsedTime(2, Number.NaN, 16)).toBe(2);
    expect(advanceElapsedTime(2, 0.35, Number.NaN)).toBe(2);
  });
});
