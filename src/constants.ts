import type { LayerKey, RenderSettings } from './types';

export const SCHEMA_VERSION = 2;
export const DB_NAME = 'interactive-cmyk-moire';
export const DB_VERSION = 2;
export const WORKSPACE_STORE = 'workspace';
export const PRESETS_STORE = 'presets';
export const CURRENT_WORKSPACE_ID = 'current' as const;

export const COPY = {
  appTitle: 'Interactive CMYK Moiré',
  eyebrow: 'Generative CMYK canvas',
  intro: 'Layered color, motion, and touch-responsive flow lines in a local-first canvas.',
  settings: 'Settings',
  openSettings: 'Open settings',
  closeSettings: 'Close settings',
  play: 'Play',
  pause: 'Pause',
  randomize: 'Randomize',
  reset: 'Reset',
  savePng: 'Save PNG',
  fullscreen: 'Fullscreen',
  exitFullscreen: 'Exit fullscreen',
  canvasView: 'Canvas view',
  exitCanvasView: 'Exit canvas view',
  close: 'Close',
  mode: 'Mode',
  flowline: 'Flow line',
  dot: 'Dot',
  hybrid: 'Flow line + Dot',
  lineSpacing: 'Line spacing',
  thickness: 'Thickness',
  noiseStrength: 'Noise strength',
  noiseScale: 'Noise scale',
  interactionStrength: 'Interaction strength',
  influenceRadius: 'Influence radius',
  speed: 'Speed',
  layers: 'Layers',
  visible: 'Visible',
  presets: 'Presets',
  currentSettings: 'Current settings',
  builtIn: 'Built-in',
  saved: 'Saved',
  saveAsNew: 'Save as New',
  load: 'Load',
  overwrite: 'Overwrite',
  rename: 'Rename',
  delete: 'Delete',
  presetName: 'Preset name',
  unsavedChanges: 'Unsaved changes',
  saving: 'Saving...',
  save: 'Save',
  cancel: 'Cancel',
  saveAsNewPreset: 'Save as New Preset',
  renamePreset: 'Rename Preset',
  loadConfirm: (name: string) => `Load preset "${name}" and discard current changes?`,
  overwriteConfirm: (name: string) => `Overwrite preset "${name}"?`,
  deleteConfirm: (name: string) => `Delete preset "${name}"?`,
  cannotUndo: 'This action cannot be undone.',
  noSavedPresets: 'No presets saved yet. Save the current settings as a preset.',
  noVisibleLayer: 'Turn on at least one of C / M / Y / K.',
  builtInDescription: 'Ready-to-use starting point',
  couldNotSaveSettings: 'Could not save settings.',
  couldNotLoadSettings: 'Could not load saved settings.',
  couldNotSavePreset: 'Could not save the preset.',
  couldNotLoadPreset: 'Could not load the preset.',
  couldNotDeletePreset: 'Could not delete the preset.',
  couldNotSaveImage: 'Could not save the image. Please try again.',
  webgl2Unavailable: 'WebGL2 is required to render this artwork. Please use a browser with WebGL2 enabled.',
  webglShaderError: 'The WebGL shader could not be initialized.',
  webglContextLost: 'The WebGL context was lost. Please reload the page.',
  fallbackSaveHint: 'Long-press the image to save it.',
  fullscreenUnavailable: 'Fullscreen is not available in this environment.',
  fullscreenFailed: 'Could not enter fullscreen.',
  updateAvailable: 'A new version is available. Reload.',
  reload: 'Reload',
  renderError: 'Could not render the canvas.',
  storageLocalOnly: 'Your settings stay in this browser.',
  resetConfirm: 'Reset settings to defaults?',
} as const;

export const LAYER_DEFINITIONS: Record<LayerKey, {
  label: string;
  color: string;
  opacity: number;
  offsetX: number;
  offsetY: number;
  noisePhase: number;
  timePhase: number;
  displacementScale: number;
  isMask: boolean;
}> = {
  c: { label: 'C', color: '#00C8FF', opacity: 0.70, offsetX: 0, offsetY: 0, noisePhase: 0, timePhase: 0, displacementScale: 1, isMask: false },
  m: { label: 'M', color: '#FF2DAA', opacity: 0.64, offsetX: 0.3, offsetY: -0.2, noisePhase: 0.03, timePhase: 0.02, displacementScale: 1.01, isMask: false },
  y: { label: 'Y', color: '#FFE94A', opacity: 0.58, offsetX: -0.3, offsetY: 0.2, noisePhase: 0.06, timePhase: 0.04, displacementScale: 0.99, isMask: false },
  k: { label: 'K', color: '#000000', opacity: 0.30, offsetX: 0.2, offsetY: 0.3, noisePhase: 0.08, timePhase: 0.06, displacementScale: 1, isMask: true },
};

export const LAYER_KEYS: LayerKey[] = ['c', 'm', 'y', 'k'];

export const DEFAULT_SETTINGS: RenderSettings = {
  mode: 'flowline',
  lineSpacing: 3.5,
  thickness: 0.8,
  noiseStrength: 28,
  noiseScale: 0.0045,
  interactionStrength: 52,
  influenceRadius: 180,
  speed: 0.18,
  randomSeed: 1234567890,
  layers: {
    c: { visible: true },
    m: { visible: true },
    y: { visible: true },
    k: { visible: true },
  },
};

export const PARAMETER_RANGES = {
  lineSpacing: { min: 2, max: 8, step: 0.1 },
  thickness: { min: 0.4, max: 1.6, step: 0.1 },
  noiseStrength: { min: 0, max: 80, step: 1 },
  noiseScale: { min: 0.0015, max: 0.012, step: 0.0001 },
  interactionStrength: { min: 0, max: 120, step: 1 },
  influenceRadius: { min: 80, max: 400, step: 1 },
  speed: { min: 0, max: 1, step: 0.01 },
  randomSeed: { min: 0, max: 4_294_967_295, step: 1 },
};

export const BUILT_IN_PRESETS = [
  {
    id: 'builtin-evening-moire',
    name: 'Evening Moiré',
    description: 'A balanced four-color starting point',
    overrides: {},
  },
  {
    id: 'builtin-cyan-drift',
    name: 'Cyan Drift',
    description: 'Cool, spacious lines with a calm motion',
    overrides: { lineSpacing: 5.5, thickness: 0.7, noiseStrength: 20, noiseScale: 0.003, interactionStrength: 34, influenceRadius: 220, speed: 0.12, mode: 'flowline' as const, randomSeed: 782341 },
  },
  {
    id: 'builtin-ink-bloom',
    name: 'Ink Bloom',
    description: 'Dense ink-like dots with controlled movement',
    overrides: { lineSpacing: 3, thickness: 0.9, noiseStrength: 32, noiseScale: 0.005, interactionStrength: 54, influenceRadius: 150, speed: 0.24, mode: 'dot' as const, randomSeed: 193847562 },
  },
  {
    id: 'builtin-dotmatrix-interpolation',
    name: 'Dotmatrix Interpolation',
    description: 'CMYK line interpolation via dotmatrix',
    overrides: {
      lineSpacing: 2.9,
      thickness: 0.7,
      noiseStrength: 18,
      noiseScale: 0.0065,
      interactionStrength: 42,
      influenceRadius: 170,
      speed: 0.12,
      randomSeed: 215,
      mode: 'hybrid' as const,
    },
  },
] as const;
