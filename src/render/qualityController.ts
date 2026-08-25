export type RenderQuality = 1 | 0.75 | 0.5;

export const QUALITY_TRANSITION_MS = 350;

export class QualityController {
  private quality: RenderQuality = 1;
  private visualQuality = 1;
  private visualTarget: RenderQuality = 1;
  private transitionFrom = 1;
  private transitionStartedAt = 0;
  private samples: number[] = [];
  private lastChangeAt = 0;
  private lowSince = 0;
  private highSince = 0;

  get value(): RenderQuality {
    return this.quality;
  }

  getRenderQuality(timestamp: number): number {
    if (this.visualTarget !== this.quality) {
      this.transitionFrom = this.visualQuality;
      this.visualTarget = this.quality;
      this.transitionStartedAt = timestamp;
    }

    const progress = Math.min(1, Math.max(0, (timestamp - this.transitionStartedAt) / QUALITY_TRANSITION_MS));
    const easedProgress = progress * (2 - progress);
    this.visualQuality = this.transitionFrom + (this.visualTarget - this.transitionFrom) * easedProgress;
    if (progress >= 1) this.visualQuality = this.visualTarget;
    return this.visualQuality;
  }

  sample(timestamp: number, deltaMs: number): RenderQuality {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return this.quality;
    this.samples.push(1000 / deltaMs);
    if (this.samples.length > 120) this.samples.shift();
    if (this.samples.length < 30 || timestamp - this.lastChangeAt < 3000) return this.quality;
    const average = this.samples.reduce((sum, fps) => sum + fps, 0) / this.samples.length;
    if (average < 40) {
      this.lowSince ||= timestamp;
      this.highSince = 0;
      if (timestamp - this.lowSince >= 2000 && this.quality !== 0.5) {
        this.quality = this.quality === 1 ? 0.75 : 0.5;
        this.lastChangeAt = timestamp;
        this.lowSince = 0;
      }
    } else if (average >= 55) {
      this.highSince ||= timestamp;
      this.lowSince = 0;
      if (timestamp - this.highSince >= 5000 && this.quality !== 1) {
        this.quality = this.quality === 0.5 ? 0.75 : 1;
        this.lastChangeAt = timestamp;
        this.highSince = 0;
      }
    } else {
      this.lowSince = 0;
      this.highSince = 0;
    }
    return this.quality;
  }
}
