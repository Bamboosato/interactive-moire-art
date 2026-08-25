export type RenderMode = 'flowline' | 'dot' | 'hybrid';
export type LayerKey = 'c' | 'm' | 'y' | 'k';
export type ViewMode = 'normal' | 'fullscreen' | 'canvas';

export interface LayerSettings {
  visible: boolean;
}

export interface RenderSettings {
  mode: RenderMode;
  lineSpacing: number;
  thickness: number;
  noiseStrength: number;
  noiseScale: number;
  interactionStrength: number;
  influenceRadius: number;
  speed: number;
  randomSeed: number;
  layers: Record<LayerKey, LayerSettings>;
}

export interface PresetSnapshot extends RenderSettings {}

export interface PresetRecord extends PresetSnapshot {
  id: string;
  name: string;
  builtIn: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface WorkspaceRecord {
  id: 'current';
  schemaVersion: number;
  settings: RenderSettings;
  updatedAt: number;
}

export interface PointerPosition {
  x: number;
  y: number;
  active: boolean;
}

export interface PointerState extends PointerPosition {
  velocityX: number;
  velocityY: number;
  strength: number;
}
