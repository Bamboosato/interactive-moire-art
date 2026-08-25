import { fbm3D } from './noise';
import type { PointerState, RenderSettings } from '../types';

export interface FlowLayerProfile {
  offsetX: number;
  offsetY: number;
  noisePhase: number;
  timePhase: number;
  displacementScale: number;
}

export interface FlowFieldSample {
  offsetX: number;
  offsetY: number;
}

export interface FlowFieldSampler {
  sample: (x: number, baseY: number) => FlowFieldSample;
}

export function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function calculatePointerInfluence(distance: number, influenceRadius: number): number {
  return smoothstep(influenceRadius, 0, distance);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(left: number, right: number, amount: number): number {
  return left + (right - left) * amount;
}

function sampleBaseFlow(
  x: number,
  baseY: number,
  elapsedTime: number,
  settings: RenderSettings,
  layerProfile: FlowLayerProfile,
): FlowFieldSample {
  const scale = settings.noiseScale;
  const sampleX = (x + layerProfile.offsetX) * scale;
  const sampleY = (baseY + layerProfile.offsetY) * scale;
  const time = elapsedTime * 0.18 + layerProfile.timePhase;
  const seed = settings.randomSeed + layerProfile.noisePhase * 10_000;
  const primaryNoise = fbm3D(sampleX, sampleY, time, seed, 4);
  const secondaryNoise = fbm3D(sampleX * 0.72 + 13.7, sampleY * 0.72 - 7.3, time * 0.8 + 4.1, seed + 71, 3);
  const noiseStrength = settings.noiseStrength * layerProfile.displacementScale;
  const offsetY = primaryNoise * noiseStrength;
  const offsetX = secondaryNoise * noiseStrength * 0.08;
  const wave = Math.sin(x * 0.009 + baseY * 0.015 + elapsedTime * 0.8 + layerProfile.timePhase)
    * noiseStrength
    * 0.12;

  return { offsetX, offsetY: offsetY + wave };
}

function applyPointerInfluence(
  x: number,
  baseY: number,
  width: number,
  height: number,
  elapsedTime: number,
  settings: RenderSettings,
  layerProfile: FlowLayerProfile,
  pointer: PointerState,
  base: FlowFieldSample,
): FlowFieldSample {
  const pointerStrength = clamp(pointer.strength, 0, 1);
  if (!pointer.active || pointerStrength === 0 || settings.interactionStrength === 0) return base;

  const pointerX = pointer.x * width;
  const pointerY = pointer.y * height;
  const deltaX = x - pointerX;
  const deltaY = baseY - pointerY;
  const distance = Math.hypot(deltaX, deltaY);
  const influence = calculatePointerInfluence(distance, settings.influenceRadius) * pointerStrength;
  if (influence === 0) return base;

  const interaction = settings.interactionStrength * layerProfile.displacementScale;
  const radius = Math.max(settings.influenceRadius, 1);
  const radialDirection = Math.cos(distance / radius * Math.PI * 2 + elapsedTime * 0.6);
  const radialWarp = radialDirection * interaction * 0.32 * influence;
  const dragX = clamp(pointer.velocityX * 0.025, -interaction * 0.35, interaction * 0.35) * influence;
  const dragY = clamp(pointer.velocityY * 0.025, -interaction * 0.35, interaction * 0.35) * influence;
  const swirl = clamp(deltaX / radius, -1, 1) * interaction * 0.18 * influence;

  return {
    offsetX: base.offsetX + dragX * 0.25,
    offsetY: base.offsetY + radialWarp + dragY + swirl,
  };
}

export function sampleFlowField(
  x: number,
  baseY: number,
  width: number,
  height: number,
  elapsedTime: number,
  settings: RenderSettings,
  layerProfile: FlowLayerProfile,
  pointer: PointerState,
): FlowFieldSample {
  return applyPointerInfluence(
    x,
    baseY,
    width,
    height,
    elapsedTime,
    settings,
    layerProfile,
    pointer,
    sampleBaseFlow(x, baseY, elapsedTime, settings, layerProfile),
  );
}

export function createFlowFieldSampler(
  width: number,
  height: number,
  elapsedTime: number,
  settings: RenderSettings,
  layerProfile: FlowLayerProfile,
  pointer: PointerState,
  gridSize = 48,
): FlowFieldSampler {
  const cellSize = Math.max(1, gridSize);
  const padding = 64;
  const startX = Math.floor(-padding / cellSize) * cellSize;
  const startY = Math.floor(-padding / cellSize) * cellSize;
  const endX = Math.ceil((width + padding) / cellSize) * cellSize;
  const endY = Math.ceil((height + padding) / cellSize) * cellSize;
  const columns = Math.round((endX - startX) / cellSize) + 1;
  const rows = Math.round((endY - startY) / cellSize) + 1;
  const baseGrid = new Float32Array(columns * rows * 2);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const sampled = sampleBaseFlow(startX + column * cellSize, startY + row * cellSize, elapsedTime, settings, layerProfile);
      const index = (row * columns + column) * 2;
      baseGrid[index] = sampled.offsetX;
      baseGrid[index + 1] = sampled.offsetY;
    }
  }

  return {
    sample: (x, baseY) => {
      const gridX = Math.min(columns - 2, Math.max(0, Math.floor((x - startX) / cellSize)));
      const gridY = Math.min(rows - 2, Math.max(0, Math.floor((baseY - startY) / cellSize)));
      const tx = Math.min(1, Math.max(0, (x - (startX + gridX * cellSize)) / cellSize));
      const ty = Math.min(1, Math.max(0, (baseY - (startY + gridY * cellSize)) / cellSize));
      const topLeftIndex = (gridY * columns + gridX) * 2;
      const topRightIndex = topLeftIndex + 2;
      const bottomLeftIndex = ((gridY + 1) * columns + gridX) * 2;
      const bottomRightIndex = bottomLeftIndex + 2;
      const base = {
        offsetX: lerp(lerp(baseGrid[topLeftIndex], baseGrid[topRightIndex], tx), lerp(baseGrid[bottomLeftIndex], baseGrid[bottomRightIndex], tx), ty),
        offsetY: lerp(lerp(baseGrid[topLeftIndex + 1], baseGrid[topRightIndex + 1], tx), lerp(baseGrid[bottomLeftIndex + 1], baseGrid[bottomRightIndex + 1], tx), ty),
      };
      return applyPointerInfluence(x, baseY, width, height, elapsedTime, settings, layerProfile, pointer, base);
    },
  };
}
