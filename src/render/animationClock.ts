export function advanceElapsedTime(current: number, speed: number, deltaMs: number): number {
  const safeCurrent = Number.isFinite(current) ? current : 0;
  const safeSpeed = Number.isFinite(speed) ? speed : 0;
  const safeDeltaMs = Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : 0;
  return safeCurrent + safeSpeed * safeDeltaMs / 1000;
}
