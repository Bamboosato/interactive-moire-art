import { describe, expect, it } from 'vitest';
import { QualityController } from './qualityController';

describe('QualityController', () => {
  it('reduces quality after sustained low FPS and honors cooldown', () => {
    const controller = new QualityController();
    let quality = controller.value;
    for (let timestamp = 0; timestamp < 12000; timestamp += 100) quality = controller.sample(timestamp, 30);
    expect(quality).toBe(0.5);
    const afterChange = controller.value;
    for (let timestamp = 12000; timestamp < 14000; timestamp += 100) controller.sample(timestamp, 30);
    expect(controller.value).toBe(afterChange);
  });

  it('recovers quality only after sustained high FPS', () => {
    const controller = new QualityController();
    for (let timestamp = 0; timestamp < 12000; timestamp += 100) controller.sample(timestamp, 30);
    expect(controller.value).toBe(0.5);
    for (let timestamp = 12000; timestamp < 36000; timestamp += 100) controller.sample(timestamp, 16);
    expect(controller.value).toBe(1);
  });

  it('interpolates visual quality after a target change', () => {
    const controller = new QualityController();
    for (let timestamp = 0; timestamp < 12000; timestamp += 100) controller.sample(timestamp, 30);
    expect(controller.value).toBe(0.5);

    const start = controller.getRenderQuality(12000);
    const middle = controller.getRenderQuality(12175);
    const end = controller.getRenderQuality(12400);

    expect(start).toBe(1);
    expect(middle).toBeGreaterThan(0.5);
    expect(middle).toBeLessThan(1);
    expect(end).toBe(0.5);
  });
});
