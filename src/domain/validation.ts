import { DEFAULT_SETTINGS, LAYER_KEYS, PARAMETER_RANGES } from '../constants';
import type { LayerKey, RenderMode, RenderSettings } from '../types';

const MODES: RenderMode[] = ['flowline', 'dot', 'hybrid'];
const LEGACY_DEFAULT_NOISE_SCALE = DEFAULT_SETTINGS.noiseScale;

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeSeed(value: unknown, fallback: number): number {
  const seed = finiteOr(value, fallback);
  return clamp(Math.floor(seed), PARAMETER_RANGES.randomSeed.min, PARAMETER_RANGES.randomSeed.max);
}

function legacyLineSpacing(value: unknown): number {
  const legacyPeriod = finiteOr(value, DEFAULT_SETTINGS.lineSpacing / 0.25);
  return legacyPeriod * 0.25;
}

function legacyThickness(value: unknown): number {
  return finiteOr(value, DEFAULT_SETTINGS.thickness / 0.57) * 0.57;
}

function legacyNoiseStrength(value: unknown): number {
  return finiteOr(value, DEFAULT_SETTINGS.noiseStrength * (48 / 28)) * (28 / 48);
}

function legacyInteractionStrength(value: unknown): number {
  return finiteOr(value, DEFAULT_SETTINGS.interactionStrength * (48 / 52)) * (52 / 48);
}

function normalizeMode(value: unknown): RenderMode {
  if (value === 'line') return 'flowline';
  return MODES.includes(value as RenderMode) ? value as RenderMode : DEFAULT_SETTINGS.mode;
}

export function normalizeSettings(value: unknown): RenderSettings {
  const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const rawLayers = candidate.layers && typeof candidate.layers === 'object'
    ? candidate.layers as Partial<Record<LayerKey, { visible?: unknown }>>
    : {};
  const isLegacy = !('lineSpacing' in candidate);

  const layers = Object.fromEntries(LAYER_KEYS.map((key) => {
    const raw = rawLayers[key] ?? {};
    const fallback = DEFAULT_SETTINGS.layers[key];
    return [key, { visible: typeof raw.visible === 'boolean' ? raw.visible : fallback.visible }];
  })) as RenderSettings['layers'];

  const legacyDistortion = candidate.distortion;
  return {
    mode: normalizeMode(candidate.mode),
    lineSpacing: clamp(
      finiteOr(candidate.lineSpacing, isLegacy ? legacyLineSpacing(candidate.period) : DEFAULT_SETTINGS.lineSpacing),
      PARAMETER_RANGES.lineSpacing.min,
      PARAMETER_RANGES.lineSpacing.max,
    ),
    thickness: clamp(
      isLegacy ? legacyThickness(candidate.thickness) : finiteOr(candidate.thickness, DEFAULT_SETTINGS.thickness),
      PARAMETER_RANGES.thickness.min,
      PARAMETER_RANGES.thickness.max,
    ),
    noiseStrength: clamp(
      finiteOr(candidate.noiseStrength, isLegacy ? legacyNoiseStrength(legacyDistortion) : DEFAULT_SETTINGS.noiseStrength),
      PARAMETER_RANGES.noiseStrength.min,
      PARAMETER_RANGES.noiseStrength.max,
    ),
    noiseScale: clamp(
      finiteOr(candidate.noiseScale, LEGACY_DEFAULT_NOISE_SCALE),
      PARAMETER_RANGES.noiseScale.min,
      PARAMETER_RANGES.noiseScale.max,
    ),
    interactionStrength: clamp(
      finiteOr(candidate.interactionStrength, isLegacy ? legacyInteractionStrength(legacyDistortion) : DEFAULT_SETTINGS.interactionStrength),
      PARAMETER_RANGES.interactionStrength.min,
      PARAMETER_RANGES.interactionStrength.max,
    ),
    influenceRadius: clamp(
      finiteOr(candidate.influenceRadius, DEFAULT_SETTINGS.influenceRadius),
      PARAMETER_RANGES.influenceRadius.min,
      PARAMETER_RANGES.influenceRadius.max,
    ),
    speed: clamp(finiteOr(candidate.speed, DEFAULT_SETTINGS.speed), PARAMETER_RANGES.speed.min, PARAMETER_RANGES.speed.max),
    randomSeed: normalizeSeed(candidate.randomSeed, DEFAULT_SETTINGS.randomSeed),
    layers,
  };
}

export function isValidPersistedSettings(value: unknown): value is RenderSettings {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RenderSettings>;
  return MODES.includes(candidate.mode as RenderMode)
    && typeof candidate.lineSpacing === 'number' && Number.isFinite(candidate.lineSpacing)
    && typeof candidate.thickness === 'number' && Number.isFinite(candidate.thickness)
    && typeof candidate.noiseStrength === 'number' && Number.isFinite(candidate.noiseStrength)
    && typeof candidate.noiseScale === 'number' && Number.isFinite(candidate.noiseScale)
    && typeof candidate.interactionStrength === 'number' && Number.isFinite(candidate.interactionStrength)
    && typeof candidate.influenceRadius === 'number' && Number.isFinite(candidate.influenceRadius)
    && typeof candidate.speed === 'number' && Number.isFinite(candidate.speed)
    && typeof candidate.randomSeed === 'number' && Number.isFinite(candidate.randomSeed)
    && Boolean(candidate.layers && typeof candidate.layers === 'object')
    && LAYER_KEYS.every((key) => {
      const layer = candidate.layers?.[key];
      return Boolean(layer && typeof layer === 'object' && typeof layer.visible === 'boolean');
    });
}

export function settingsEqual(left: RenderSettings, right: RenderSettings): boolean {
  return left.mode === right.mode
    && left.lineSpacing === right.lineSpacing
    && left.thickness === right.thickness
    && left.noiseStrength === right.noiseStrength
    && left.noiseScale === right.noiseScale
    && left.interactionStrength === right.interactionStrength
    && left.influenceRadius === right.influenceRadius
    && left.speed === right.speed
    && left.randomSeed === right.randomSeed
    && LAYER_KEYS.every((key) => left.layers[key].visible === right.layers[key].visible);
}

export function validatePresetName(value: string): { valid: true; name: string } | { valid: false; message: string } {
  const name = value.trim();
  const length = Array.from(name).length;
  if (length < 1 || length > 64) {
    return { valid: false, message: 'Preset name must be between 1 and 64 characters.' };
  }
  return { valid: true, name };
}

export function randomizeSettings(random: () => number = Math.random): RenderSettings {
  const randomBetween = (min: number, max: number) => min + random() * (max - min);
  const roundTo = (value: number, digits: number) => {
    const factor = 10 ** digits;
    return Math.round((value + 1e-9) * factor) / factor;
  };
  const next = normalizeSettings({
    ...DEFAULT_SETTINGS,
    mode: MODES[Math.floor(random() * MODES.length)],
    lineSpacing: roundTo(randomBetween(2.2, 4.8), 1),
    thickness: roundTo(randomBetween(0.2, 0.6), 2),
    noiseStrength: Math.round(randomBetween(12, 52)),
    noiseScale: roundTo(randomBetween(0.0025, 0.008), 4),
    interactionStrength: Math.round(randomBetween(20, 90)),
    influenceRadius: Math.round(randomBetween(100, 220)),
    speed: roundTo(randomBetween(0.05, 0.6), 2),
    randomSeed: Math.floor(random() * 4_294_967_296),
    layers: Object.fromEntries(LAYER_KEYS.map((key) => [key, { ...DEFAULT_SETTINGS.layers[key] }])),
  });
  return next;
}

export function cloneSettings(settings: RenderSettings): RenderSettings {
  return normalizeSettings(JSON.parse(JSON.stringify(settings)));
}
