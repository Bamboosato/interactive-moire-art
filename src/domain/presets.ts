import { BUILT_IN_PRESETS, DEFAULT_SETTINGS, LAYER_KEYS } from '../constants';
import { cloneSettings, normalizeSettings } from './validation';
import type { PresetRecord, RenderSettings } from '../types';

export interface BuiltInPreset {
  id: string;
  name: string;
  description: string;
  builtIn: true;
  settings: RenderSettings;
}

export function getBuiltInPresets(): BuiltInPreset[] {
  return BUILT_IN_PRESETS.map((preset) => ({
      id: preset.id,
      name: preset.name,
      description: preset.description,
      builtIn: true as const,
      settings: normalizeSettings({
      ...DEFAULT_SETTINGS,
      ...preset.overrides,
      layers: Object.fromEntries(LAYER_KEYS.map((key) => {
        const overrides = preset.overrides as Partial<RenderSettings>;
        return [key, { ...DEFAULT_SETTINGS.layers[key], ...(overrides.layers?.[key] ?? {}) }];
      })),
    }),
  }));
}

export function makePresetRecord(name: string, settings: RenderSettings, now = Date.now(), id: string = crypto.randomUUID()): PresetRecord {
  const snapshot = cloneSettings(settings);
  return {
    id,
    name,
    builtIn: false,
    createdAt: now,
    updatedAt: now,
    ...snapshot,
  };
}
