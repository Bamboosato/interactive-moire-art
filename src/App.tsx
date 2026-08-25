import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COPY, DEFAULT_SETTINGS, LAYER_DEFINITIONS, LAYER_KEYS, PARAMETER_RANGES } from './constants';
import { getBuiltInPresets, makePresetRecord, type BuiltInPreset } from './domain/presets';
import {
  cloneSettings,
  normalizeSettings,
  randomizeSettings,
  settingsEqual,
  validatePresetName,
} from './domain/validation';
import { QualityController } from './render/qualityController';
import { advanceElapsedTime } from './render/animationClock';
import { WebGLRenderer, WebGLRendererError } from './render/webglRenderer';
import { IndexedDbRepository } from './persistence/indexedDb';
import type { LayerKey, PointerPosition, PointerState, PresetRecord, RenderSettings, ViewMode } from './types';
import './styles.css';

type PresetEntry = BuiltInPreset | PresetRecord;
type SaveStatus = 'idle' | 'saving' | 'saved';
type DialogState =
  | { kind: 'save'; name: string }
  | { kind: 'rename'; name: string; entry: PresetRecord }
  | { kind: 'load'; entry: PresetEntry }
  | { kind: 'overwrite'; entry: PresetRecord }
  | { kind: 'delete'; entry: PresetRecord };

const CENTER_POINTER: PointerPosition = { x: 0.5, y: 0.5, active: false };
const RESIZE_SETTLE_MS = 80;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function formatDate(timestamp: number): string {
  const formatter = new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return formatter.format(new Date(timestamp));
}

function formatNumber(value: number, digits = 1): string {
  return value.toFixed(digits).replace(/\.0+$/, '');
}

function presetSettings(entry: PresetEntry): RenderSettings {
  return 'settings' in entry ? cloneSettings(entry.settings) : cloneSettings(entry);
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function useIsStandalone(): boolean {
  const [standalone, setStandalone] = useState(false);
  useEffect(() => {
    const standaloneMedia = window.matchMedia?.('(display-mode: standalone)');
    const fullscreenMedia = window.matchMedia?.('(display-mode: fullscreen)');
    const update = () => setStandalone(Boolean(
      standaloneMedia?.matches
      || fullscreenMedia?.matches
      || (navigator as Navigator & { standalone?: boolean }).standalone,
    ));
    update();
    standaloneMedia?.addEventListener?.('change', update);
    fullscreenMedia?.addEventListener?.('change', update);
    return () => {
      standaloneMedia?.removeEventListener?.('change', update);
      fullscreenMedia?.removeEventListener?.('change', update);
    };
  }, []);
  return standalone;
}

function PresetDialog({
  dialog,
  onClose,
  onSubmit,
  onNameChange,
  error,
  busy,
}: {
  dialog: DialogState;
  onClose: () => void;
  onSubmit: () => void;
  onNameChange: (name: string) => void;
  error: string;
  busy: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (dialog.kind === 'save' || dialog.kind === 'rename') inputRef.current?.focus();
  }, [dialog.kind]);

  const isNameDialog = dialog.kind === 'save' || dialog.kind === 'rename';
  const entryName = 'entry' in dialog ? dialog.entry.name : '';
  const title = dialog.kind === 'save' ? COPY.saveAsNewPreset : dialog.kind === 'rename' ? COPY.renamePreset :
    dialog.kind === 'load' ? COPY.load : dialog.kind === 'overwrite' ? COPY.overwrite : COPY.delete;
  const description = dialog.kind === 'load' ? COPY.loadConfirm(entryName)
    : dialog.kind === 'overwrite' ? COPY.overwriteConfirm(entryName)
      : dialog.kind === 'delete' ? `${COPY.deleteConfirm(entryName)} ${COPY.cannotUndo}` : '';

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section
        className="dialog-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preset-dialog-title"
        onKeyDown={(event) => { if (event.key === 'Escape' && !busy) onClose(); }}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id="preset-dialog-title" className="text-lg font-semibold text-app-text">{title}</h2>
          <button className="icon-button" type="button" aria-label={COPY.close} onClick={onClose} disabled={busy}>×</button>
        </div>
        {description && <p className="mt-3 text-sm leading-6 text-app-muted">{description}</p>}
        {isNameDialog && (
          <label className="mt-5 block text-sm font-medium text-app-text" htmlFor="preset-name">
            {COPY.presetName}
            <input
              ref={inputRef}
              id="preset-name"
              className="control-input mt-2 w-full"
              value={dialog.name}
              maxLength={64}
              onChange={(event) => onNameChange(event.target.value)}
              disabled={busy}
            />
          </label>
        )}
        {error && <p className="mt-3 text-sm text-app-danger" role="alert">{error}</p>}
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" className="button-secondary" onClick={onClose} disabled={busy}>{COPY.cancel}</button>
          <button type="button" className="button-primary" onClick={onSubmit} disabled={busy}>
            {busy ? COPY.saving : isNameDialog ? COPY.save : dialog.kind === 'load' ? COPY.load : dialog.kind === 'overwrite' ? COPY.overwrite : COPY.delete}
          </button>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const builtIns = useMemo(() => getBuiltInPresets(), []);
  const repositoryRef = useRef<IndexedDbRepository | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasStageRef = useRef<HTMLDivElement>(null);
  const fullscreenButtonRef = useRef<HTMLButtonElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const settingsPanelRef = useRef<HTMLElement>(null);
  const dialogTriggerRef = useRef<HTMLElement | null>(null);
  const saveTimerRef = useRef<number | undefined>(undefined);
  const savedTimerRef = useRef<number | undefined>(undefined);
  const settingsRef = useRef<RenderSettings>(cloneSettings(DEFAULT_SETTINGS));
  const elapsedTimeRef = useRef(0);
  const playingRef = useRef(!prefersReducedMotion());
  const pointerTargetRef = useRef<PointerPosition>({ ...CENTER_POINTER });
  const pointerTargetVelocityRef = useRef({ x: 0, y: 0 });
  const pointerCurrentRef = useRef<PointerState>({ ...CENTER_POINTER, velocityX: 0, velocityY: 0, strength: 0 });
  const lastPointerSampleRef = useRef({ x: CENTER_POINTER.x, y: CENTER_POINTER.y, timestamp: performance.now() });
  const qualityControllerRef = useRef(new QualityController());
  const webglRendererRef = useRef<WebGLRenderer | null>(null);
  const userInteractedRef = useRef(false);
  const storageErrorShownRef = useRef(false);
  const storageInitializedRef = useRef(false);
  const resizeCanvasRef = useRef<() => void>(() => undefined);
  const requestRenderRef = useRef<() => void>(() => undefined);
  const renderRequestedRef = useRef(false);

  const [settings, setSettings] = useState<RenderSettings>(() => cloneSettings(DEFAULT_SETTINGS));
  const [playing, setPlaying] = useState(!prefersReducedMotion());
  const [panelOpen, setPanelOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('normal');
  const [userPresets, setUserPresets] = useState<PresetRecord[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState(builtIns[0].id);
  const [loadedPresetId, setLoadedPresetId] = useState<string | null>(null);
  const [loadedSnapshot, setLoadedSnapshot] = useState<RenderSettings | null>(null);
  const [presetDirty, setPresetDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [storageMessage, setStorageMessage] = useState('');
  const [operationMessage, setOperationMessage] = useState('');
  const [renderError, setRenderError] = useState('');
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogError, setDialogError] = useState('');
  const [dialogBusy, setDialogBusy] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [swRegistration, setSwRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const standalone = useIsStandalone();

  const allPresets = useMemo<PresetEntry[]>(() => [...builtIns, ...userPresets], [builtIns, userPresets]);
  const selectedPreset = allPresets.find((entry) => entry.id === selectedPresetId) ?? null;

  const showStorageError = useCallback((message: string = COPY.couldNotSaveSettings) => {
    if (storageErrorShownRef.current) return;
    storageErrorShownRef.current = true;
    setStorageMessage(message);
  }, []);

  const scheduleWorkspaceSave = useCallback((nextSettings: RenderSettings) => {
    window.clearTimeout(saveTimerRef.current);
    setSaveStatus('saving');
    saveTimerRef.current = window.setTimeout(() => {
      repositoryRef.current?.saveCurrent(nextSettings)
        .then(() => {
          setSaveStatus('saved');
          window.clearTimeout(savedTimerRef.current);
          savedTimerRef.current = window.setTimeout(() => setSaveStatus('idle'), 1600);
        })
        .catch(() => {
          setSaveStatus('idle');
          showStorageError();
        });
    }, 300);
  }, [showStorageError]);

  const updateSettings = useCallback((next: RenderSettings, markInteraction = true) => {
    const normalized = normalizeSettings(next);
    if (markInteraction) userInteractedRef.current = true;
    settingsRef.current = normalized;
    setSettings(normalized);
    if (loadedPresetId && loadedSnapshot) setPresetDirty(!settingsEqual(normalized, loadedSnapshot));
    scheduleWorkspaceSave(normalized);
    requestRenderRef.current();
  }, [loadedPresetId, loadedSnapshot, scheduleWorkspaceSave]);

  const refreshPresets = useCallback(async () => {
    if (!repositoryRef.current) return;
    try {
      setUserPresets(await repositoryRef.current.listPresets());
    } catch {
      showStorageError(COPY.couldNotLoadPreset);
    }
  }, [showStorageError]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const update = () => {
      if (media?.matches) {
        playingRef.current = false;
        setPlaying(false);
      }
    };
    media?.addEventListener?.('change', update);
    return () => media?.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    const repository = new IndexedDbRepository();
    repositoryRef.current = repository;
    let cancelled = false;
    Promise.all([repository.loadCurrent(), repository.listPresets()])
      .then(([savedSettings, presets]) => {
        if (cancelled) return;
        setUserPresets(presets);
        if (savedSettings && !userInteractedRef.current) {
          settingsRef.current = savedSettings;
          setSettings(savedSettings);
        }
      })
      .catch(() => {
        if (!cancelled) showStorageError(COPY.couldNotLoadSettings);
      })
      .finally(() => { storageInitializedRef.current = true; });
    return () => { cancelled = true; };
  }, [showStorageError]);

  useEffect(() => {
    let cancelled = false;
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return undefined;
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      if (cancelled) return;
      setSwRegistration(registration);
      if (registration.waiting) setUpdateAvailable(true);
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) setUpdateAvailable(true);
        });
      });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const stage = canvasStageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return undefined;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer(canvas, (status, message) => {
        if (status === 'ready') {
          setRenderError('');
          requestRenderRef.current();
        }
        else setRenderError(message ?? COPY.webglContextLost);
      });
    } catch (error) {
      setRenderError(error instanceof WebGLRendererError ? error.message : COPY.webglShaderError);
      return undefined;
    }
    webglRendererRef.current = renderer;
    const dimensions = { width: 1, height: 1 };
    let lastQuality = qualityControllerRef.current.value;
    const resize = () => {
      const rect = stage.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      dimensions.width = width;
      dimensions.height = height;
      lastQuality = qualityControllerRef.current.value;
      renderer.resize(width, height, window.devicePixelRatio || 1, lastQuality);
    };
    resizeCanvasRef.current = resize;
    let animationFrame = 0;
    let previousTimestamp = performance.now();
    let lastVisible = document.visibilityState === 'visible';
    const renderFrame = (timestamp: number) => {
      animationFrame = 0;
      if (document.visibilityState !== 'visible') {
        lastVisible = false;
        return;
      }
      if (!lastVisible) {
        previousTimestamp = timestamp;
        lastVisible = true;
      }
      const deltaMs = Math.min(Math.max(timestamp - previousTimestamp, 0), 50);
      previousTimestamp = timestamp;
      if (playingRef.current) {
        elapsedTimeRef.current = advanceElapsedTime(
          elapsedTimeRef.current,
          settingsRef.current.speed,
          deltaMs,
        );
      }
      const target = pointerTargetRef.current;
      const targetVelocity = pointerTargetVelocityRef.current;
      const current = pointerCurrentRef.current;
      const positionTau = target.active ? 120 : 600;
      const positionAlpha = 1 - Math.exp(-deltaMs / positionTau);
      const strengthTau = target.active ? 100 : 200;
      const strengthAlpha = 1 - Math.exp(-deltaMs / strengthTau);
      current.x += (target.x - current.x) * positionAlpha;
      current.y += (target.y - current.y) * positionAlpha;
      current.strength += ((target.active ? 1 : 0) - current.strength) * strengthAlpha;
      if (current.strength < 0.001) current.strength = 0;
      current.active = current.strength > 0;
      current.velocityX += (targetVelocity.x - current.velocityX) * positionAlpha;
      current.velocityY += (targetVelocity.y - current.velocityY) * positionAlpha;
      if (!target.active) {
        current.velocityX *= Math.exp(-deltaMs / 220);
        current.velocityY *= Math.exp(-deltaMs / 220);
      }
      if (playingRef.current) qualityControllerRef.current.sample(timestamp, deltaMs);
      const renderQuality = qualityControllerRef.current.getRenderQuality(timestamp);
      const quality = qualityControllerRef.current.value;
      if (quality !== lastQuality) {
        lastQuality = quality;
        renderer.resize(dimensions.width, dimensions.height, window.devicePixelRatio || 1, quality, timestamp);
      }
      renderer.draw(settingsRef.current, elapsedTimeRef.current, current, renderQuality, timestamp);
      const pointerSettling = Math.hypot(target.x - current.x, target.y - current.y) > 0.001
        || current.strength > 0;
      const shouldContinue = playingRef.current || renderRequestedRef.current || pointerSettling || renderer.isTransitioning;
      renderRequestedRef.current = false;
      if (shouldContinue) animationFrame = window.requestAnimationFrame(renderFrame);
    };
    const scheduleRender = () => {
      renderRequestedRef.current = true;
      if (document.visibilityState === 'visible' && animationFrame === 0) {
        previousTimestamp = performance.now();
        animationFrame = window.requestAnimationFrame(renderFrame);
      }
    };
    requestRenderRef.current = scheduleRender;
    let resizeTimer: number | undefined;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resize();
        scheduleRender();
      }, RESIZE_SETTLE_MS);
    });
    observer.observe(stage);
    resize();
    scheduleRender();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (animationFrame) window.cancelAnimationFrame(animationFrame);
        animationFrame = 0;
        return;
      }
      scheduleRender();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(resizeTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      observer.disconnect();
      resizeCanvasRef.current = () => undefined;
      requestRenderRef.current = () => undefined;
      webglRendererRef.current = null;
      renderer.dispose();
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle('canvas-mode', viewMode !== 'normal');
    return () => document.body.classList.remove('canvas-mode');
  }, [viewMode]);

  useEffect(() => {
    if (viewMode !== 'normal') return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (window.innerWidth >= 769 || event.key !== 'Escape' || !panelOpen || dialog) return;
      setPanelOpen(false);
      window.setTimeout(() => settingsButtonRef.current?.focus(), 0);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [dialog, panelOpen, viewMode]);

  useEffect(() => {
    const onFullscreenChange = () => {
      if (document.fullscreenElement === canvasStageRef.current) {
        setViewMode('fullscreen');
        setPanelOpen(false);
      } else if (viewMode === 'fullscreen') {
        setViewMode('normal');
        window.setTimeout(() => fullscreenButtonRef.current?.focus(), 0);
      }
    };
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, [viewMode]);

  useEffect(() => () => {
    window.clearTimeout(saveTimerRef.current);
    window.clearTimeout(savedTimerRef.current);
  }, []);

  const togglePlayback = () => {
    const next = !playing;
    playingRef.current = next;
    setPlaying(next);
    requestRenderRef.current();
  };

  const closeSettings = () => {
    setPanelOpen(false);
    window.setTimeout(() => settingsButtonRef.current?.focus(), 0);
  };

  const randomize = () => {
    const randomized = randomizeSettings();
    const allHidden = LAYER_KEYS.every((key) => !settings.layers[key].visible);
    if (allHidden) {
      for (const key of LAYER_KEYS) randomized.layers[key].visible = true;
    } else {
      for (const key of LAYER_KEYS) randomized.layers[key].visible = settings.layers[key].visible;
    }
    updateSettings(randomized);
    setOperationMessage('Randomized settings.');
  };

  const reset = () => {
    elapsedTimeRef.current = 0;
    pointerTargetRef.current = { ...CENTER_POINTER };
    pointerTargetVelocityRef.current = { x: 0, y: 0 };
    pointerCurrentRef.current = { ...CENTER_POINTER, velocityX: 0, velocityY: 0, strength: 0 };
    lastPointerSampleRef.current = { x: CENTER_POINTER.x, y: CENTER_POINTER.y, timestamp: performance.now() };
    const resetSettings = cloneSettings(DEFAULT_SETTINGS);
    updateSettings(resetSettings);
    const nextPlaying = prefersReducedMotion() ? false : true;
    playingRef.current = nextPlaying;
    setPlaying(nextPlaying);
    setLoadedPresetId(null);
    setLoadedSnapshot(null);
    setPresetDirty(false);
    setSelectedPresetId(builtIns[0].id);
    setOperationMessage('Settings reset.');
  };

  const handleParameterChange = (
    key: 'lineSpacing' | 'thickness' | 'noiseStrength' | 'noiseScale' | 'interactionStrength' | 'influenceRadius' | 'speed',
    value: string,
  ) => {
    updateSettings({ ...settings, [key]: Number(value) });
  };

  const handleLayerChange = (key: LayerKey, visible: boolean) => {
    updateSettings({
      ...settings,
      layers: { ...settings.layers, [key]: { visible } },
    });
  };

  const setPointerFromEvent = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(rect.width, 1)));
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(rect.height, 1)));
    const timestamp = event.timeStamp > 0 ? event.timeStamp : performance.now();
    const previous = lastPointerSampleRef.current;
    const deltaSeconds = Math.max((timestamp - previous.timestamp) / 1000, 0.008);
    pointerTargetVelocityRef.current = {
      x: Math.min(3000, Math.max(-3000, (x - previous.x) * rect.width / deltaSeconds)),
      y: Math.min(3000, Math.max(-3000, (y - previous.y) * rect.height / deltaSeconds)),
    };
    lastPointerSampleRef.current = { x, y, timestamp };
    pointerTargetRef.current = {
      x,
      y,
      active: true,
    };
    requestRenderRef.current();
  };

  const recenterPointer = () => {
    pointerTargetRef.current = { ...CENTER_POINTER };
    pointerTargetVelocityRef.current = { x: 0, y: 0 };
    lastPointerSampleRef.current = { x: CENTER_POINTER.x, y: CENTER_POINTER.y, timestamp: performance.now() };
    requestRenderRef.current();
  };

  const handleCanvasKeyDown = (event: React.KeyboardEvent<HTMLCanvasElement>) => {
    const step = 0.05;
    const current = pointerTargetRef.current;
    if (event.key === 'Home') {
      event.preventDefault();
      recenterPointer();
      return;
    }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    pointerTargetRef.current = {
      x: Math.min(1, Math.max(0, current.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0))),
      y: Math.min(1, Math.max(0, current.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0))),
      active: true,
    };
    pointerTargetVelocityRef.current = { x: 0, y: 0 };
    requestRenderRef.current();
  };

  const enterFullscreen = async () => {
    const stage = canvasStageRef.current as (HTMLElement & { requestFullscreen?: () => Promise<void> }) | null;
    if (!stage?.requestFullscreen) {
      if (standalone) {
        setViewMode('canvas');
        setPanelOpen(false);
        return;
      }
      setOperationMessage(COPY.fullscreenUnavailable);
      return;
    }
    try {
      await stage.requestFullscreen();
      setViewMode('fullscreen');
      setPanelOpen(false);
    } catch {
      if (standalone) {
        setViewMode('canvas');
        setPanelOpen(false);
        return;
      }
      setOperationMessage(COPY.fullscreenFailed);
    }
  };

  const exitView = async () => {
    if (viewMode === 'fullscreen' && document.fullscreenElement && document.exitFullscreen) {
      try { await document.exitFullscreen(); } catch { setViewMode('normal'); }
    } else {
      setViewMode('normal');
      window.setTimeout(() => fullscreenButtonRef.current?.focus(), 0);
    }
  };

  const savePng = async () => {
    const renderer = webglRendererRef.current;
    if (!renderer) {
      setOperationMessage(renderError || COPY.couldNotSaveImage);
      return;
    }
    try {
      const blob = await renderer.capturePng(
        settingsRef.current,
        elapsedTimeRef.current,
        pointerCurrentRef.current,
        qualityControllerRef.current.getRenderQuality(performance.now()),
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      const now = new Date();
      const pad = (value: number) => String(value).padStart(2, '0');
      anchor.download = `interactive-cmyk-moire_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.png`;
      if ('download' in anchor) {
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        const tab = window.open(url, '_blank', 'noopener,noreferrer');
        if (!tab) throw new Error('Could not open the PNG preview.');
        setOperationMessage(COPY.fallbackSaveHint);
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      requestRenderRef.current();
    } catch {
      setOperationMessage(COPY.couldNotSaveImage);
    }
  };

  const openDialog = (next: DialogState, trigger?: HTMLElement | null) => {
    dialogTriggerRef.current = trigger ?? document.activeElement as HTMLElement;
    setDialogError('');
    setDialog(next);
  };

  const closeDialog = () => {
    if (dialogBusy) return;
    setDialog(null);
    setDialogError('');
    window.setTimeout(() => dialogTriggerRef.current?.focus(), 0);
  };

  const selectPreset = (entry: PresetEntry) => {
    setSelectedPresetId(entry.id);
    if (entry.id === loadedPresetId && !presetDirty) return;
    if (presetDirty) openDialog({ kind: 'load', entry });
    else applyPreset(entry);
  };

  const requestLoad = (entry: PresetEntry) => {
    setSelectedPresetId(entry.id);
    if (presetDirty) openDialog({ kind: 'load', entry });
    else applyPreset(entry);
  };

  const applyPreset = (entry: PresetEntry) => {
    const snapshot = presetSettings(entry);
    userInteractedRef.current = true;
    settingsRef.current = snapshot;
    setSettings(snapshot);
    setLoadedPresetId(entry.id);
    setLoadedSnapshot(snapshot);
    setPresetDirty(false);
    setSelectedPresetId(entry.id);
    scheduleWorkspaceSave(snapshot);
    requestRenderRef.current();
    setOperationMessage(`Loaded ${entry.name}.`);
  };

  const submitDialog = async () => {
    if (!dialog || !repositoryRef.current) return;
    setDialogBusy(true);
    try {
      if (dialog.kind === 'save') {
        const validation = validatePresetName(dialog.name);
        if (!validation.valid) { setDialogError(validation.message); return; }
        const record = makePresetRecord(validation.name, settings);
        await repositoryRef.current.createPreset(record);
        await refreshPresets();
        setSelectedPresetId(record.id);
        setLoadedPresetId(record.id);
        setLoadedSnapshot(cloneSettings(record));
        setPresetDirty(false);
        setOperationMessage(`Saved ${record.name}.`);
      } else if (dialog.kind === 'rename') {
        const validation = validatePresetName(dialog.name);
        if (!validation.valid) { setDialogError(validation.message); return; }
        const record = { ...dialog.entry, name: validation.name, updatedAt: Date.now() };
        await repositoryRef.current.updatePreset(record);
        await refreshPresets();
        setSelectedPresetId(record.id);
        setOperationMessage(`Renamed ${record.name}.`);
      } else if (dialog.kind === 'load') {
        applyPreset(dialog.entry);
      } else if (dialog.kind === 'overwrite') {
        const record = { ...dialog.entry, ...cloneSettings(settings), updatedAt: Date.now() };
        await repositoryRef.current.updatePreset(record);
        await refreshPresets();
        setLoadedPresetId(record.id);
        setLoadedSnapshot(cloneSettings(record));
        setPresetDirty(false);
        setOperationMessage(`Overwrote ${record.name}.`);
      } else if (dialog.kind === 'delete') {
        await repositoryRef.current.deletePreset(dialog.entry.id);
        await refreshPresets();
        if (loadedPresetId === dialog.entry.id) {
          setLoadedPresetId(null);
          setLoadedSnapshot(null);
          setPresetDirty(false);
        }
        if (selectedPresetId === dialog.entry.id) setSelectedPresetId(builtIns[0].id);
        setOperationMessage(`Deleted ${dialog.entry.name}.`);
      }
      setDialog(null);
      window.setTimeout(() => dialogTriggerRef.current?.focus(), 0);
    } catch (error) {
      setDialogError(errorMessage(error, COPY.couldNotSavePreset));
    } finally {
      setDialogBusy(false);
    }
  };

  const selectedCustom = selectedPreset && !selectedPreset.builtIn ? selectedPreset as PresetRecord : null;

  return (
    <div className="app-shell min-h-screen">
      {viewMode === 'normal' && (
        <header className="app-header mx-auto flex w-full max-w-[1180px] items-center justify-between gap-4 px-5 py-5 lg:px-8">
          <div>
            <p className="eyebrow">{COPY.eyebrow}</p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight text-app-text sm:text-2xl">{COPY.appTitle}</h1>
          </div>
          <button ref={settingsButtonRef} className="button-secondary mobile-only" type="button" onClick={() => setPanelOpen(true)} aria-expanded={panelOpen} aria-controls="settings-panel">
            <span aria-hidden="true">☷</span>{COPY.settings}
          </button>
        </header>
      )}

      <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-5 px-5 pb-10 lg:px-8">
        {viewMode === 'normal' && (
          <section className="intro-row flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <p className="max-w-xl text-sm leading-6 text-app-muted">{COPY.intro}</p>
            <p className="text-xs uppercase tracking-[0.18em] text-app-muted">{COPY.storageLocalOnly}</p>
          </section>
        )}

        {viewMode === 'normal' && updateAvailable && (
          <div className="status-banner" role="status">
            <span>{COPY.updateAvailable}</span>
            <button type="button" className="button-small" onClick={() => {
              swRegistration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
              window.location.reload();
            }}>{COPY.reload}</button>
          </div>
        )}

        <section className={`workspace-grid ${viewMode !== 'normal' ? 'workspace-grid-view' : ''}`}>
          <div
            ref={canvasStageRef}
            className="canvas-stage"
            aria-label={viewMode === 'fullscreen' ? COPY.exitFullscreen : COPY.appTitle}
          >
            <canvas
              ref={canvasRef}
              className="moire-canvas"
              tabIndex={0}
              aria-label="Interactive moiré artwork"
              onPointerDown={(event) => {
                if (!event.isPrimary) return;
                if (event.currentTarget.setPointerCapture) event.currentTarget.setPointerCapture(event.pointerId);
                setPointerFromEvent(event);
              }}
              onPointerMove={(event) => { if (event.isPrimary && (event.pointerType !== 'mouse' || event.buttons > 0)) setPointerFromEvent(event); }}
              onPointerLeave={(event) => { if (event.isPrimary && event.pointerType === 'mouse') recenterPointer(); }}
              onPointerUp={(event) => { if (!event.isPrimary) return; if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); recenterPointer(); }}
              onPointerCancel={recenterPointer}
              onKeyDown={handleCanvasKeyDown}
            />
            {renderError && <div className="canvas-error" role="alert">{renderError}</div>}
            {viewMode !== 'normal' && (
              <button className="canvas-exit-button" type="button" onClick={exitView}>
                {viewMode === 'fullscreen' ? COPY.exitFullscreen : COPY.exitCanvasView}
              </button>
            )}
          </div>

          {viewMode === 'normal' && <aside ref={settingsPanelRef} id="settings-panel" className={`settings-panel ${panelOpen ? 'settings-panel-open' : ''}`} aria-label={COPY.settings}>
            <div className="panel-heading">
              <div>
                <p className="eyebrow">{COPY.currentSettings}</p>
                <h2 className="text-lg font-semibold text-app-text">{COPY.settings}</h2>
              </div>
              <button className="icon-button mobile-only" type="button" aria-label={COPY.closeSettings} onClick={closeSettings}>×</button>
            </div>

            <div className="settings-scroll">
              <div className="control-group">
                <label className="field-label" htmlFor="mode">{COPY.mode}</label>
                <select id="mode" className="control-input" value={settings.mode} onChange={(event) => updateSettings({ ...settings, mode: event.target.value as RenderSettings['mode'] })}>
                  <option value="flowline">{COPY.flowline}</option>
                  <option value="dot">{COPY.dot}</option>
                  <option value="hybrid">{COPY.hybrid}</option>
                </select>
              </div>

              {([
                ['lineSpacing', COPY.lineSpacing, PARAMETER_RANGES.lineSpacing, 1],
                ['thickness', COPY.thickness, PARAMETER_RANGES.thickness, 1],
                ['noiseStrength', COPY.noiseStrength, PARAMETER_RANGES.noiseStrength, 0],
                ['noiseScale', COPY.noiseScale, PARAMETER_RANGES.noiseScale, 4],
                ['interactionStrength', COPY.interactionStrength, PARAMETER_RANGES.interactionStrength, 0],
                ['influenceRadius', COPY.influenceRadius, PARAMETER_RANGES.influenceRadius, 0],
                ['speed', COPY.speed, PARAMETER_RANGES.speed, 2],
              ] as const).map(([key, label, range, digits]) => (
                <div className="control-group" key={key}>
                  <div className="field-label-row"><label className="field-label" htmlFor={key}>{label}</label><output htmlFor={key}>{formatNumber(settings[key], digits)}</output></div>
                  <input id={key} className="range-input" type="range" min={range.min} max={range.max} step={range.step} value={settings[key]} onChange={(event) => handleParameterChange(key, event.target.value)} />
                </div>
              ))}

              <section className="layers-section" aria-labelledby="layers-heading">
                <div className="field-label-row"><h3 id="layers-heading" className="field-label">{COPY.layers}</h3><span className="text-xs text-app-muted">{COPY.visible}</span></div>
                <div className="layer-list">
                  {LAYER_KEYS.map((key) => (
                    <div className="layer-card" key={key}>
                      <label className="layer-title"><input type="checkbox" checked={settings.layers[key].visible} onChange={(event) => handleLayerChange(key, event.target.checked)} /><span className={`layer-chip layer-chip-${key}`}>{LAYER_DEFINITIONS[key].label}</span></label>
                    </div>
                  ))}
                </div>
                {LAYER_KEYS.every((key) => !settings.layers[key].visible) && <p className="empty-presets" role="status">{COPY.noVisibleLayer}</p>}
              </section>

              <section className="presets-section" aria-labelledby="presets-heading">
                <div className="field-label-row"><h3 id="presets-heading" className="field-label">{COPY.presets}</h3><span className="text-xs text-app-muted">{userPresets.length}/100</span></div>
                <label className="sr-only" htmlFor="preset-select">{COPY.presets}</label>
                <select
                  id="preset-select"
                  className="control-input preset-select"
                  value={selectedPresetId}
                  aria-describedby={presetDirty ? 'preset-dirty-state' : undefined}
                  onChange={(event) => {
                    const entry = allPresets.find((candidate) => candidate.id === event.target.value);
                    if (entry) selectPreset(entry);
                  }}
                >
                  <optgroup label={COPY.builtIn}>
                    {builtIns.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                  </optgroup>
                  {userPresets.length > 0 && (
                    <optgroup label={COPY.saved}>
                      {userPresets.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                    </optgroup>
                  )}
                </select>
                {userPresets.length === 0 && <p className="empty-presets">{COPY.noSavedPresets}</p>}
                <div className="preset-actions">
                  <button type="button" className="button-primary flex-1" onClick={(event) => openDialog({ kind: 'save', name: '' }, event.currentTarget)}>{COPY.saveAsNew}</button>
                  <button type="button" className="button-secondary" disabled={!selectedPreset} onClick={() => selectedPreset && requestLoad(selectedPreset)}>{COPY.load}</button>
                </div>
                <div className="preset-actions">
                  <button type="button" className="button-secondary flex-1" disabled={!selectedCustom} onClick={(event) => selectedCustom && openDialog({ kind: 'overwrite', entry: selectedCustom }, event.currentTarget)}>{COPY.overwrite}</button>
                  <button type="button" className="button-secondary" disabled={!selectedCustom} onClick={(event) => selectedCustom && openDialog({ kind: 'rename', name: selectedCustom.name, entry: selectedCustom }, event.currentTarget)}>{COPY.rename}</button>
                  <button type="button" className="button-danger" disabled={!selectedCustom} onClick={(event) => selectedCustom && openDialog({ kind: 'delete', entry: selectedCustom }, event.currentTarget)}>{COPY.delete}</button>
                </div>
                {presetDirty && <p id="preset-dirty-state" className="dirty-state" role="status">{COPY.unsavedChanges}</p>}
              </section>
            </div>

            <div className="panel-footer">
              <button type="button" className="button-secondary" onClick={reset}>{COPY.reset}</button>
              <span className="text-xs text-app-muted" role="status">{saveStatus === 'saving' ? COPY.saving : saveStatus === 'saved' ? COPY.saved : ''}</span>
            </div>
          </aside>}
        </section>

        {viewMode === 'normal' && <nav className="action-bar" aria-label="Canvas actions">
          <button type="button" className="button-primary" onClick={togglePlayback}>{playing ? COPY.pause : COPY.play}</button>
          <button type="button" className="button-secondary" onClick={randomize}>{COPY.randomize}</button>
          <button type="button" className="button-secondary" onClick={savePng}>{COPY.savePng}</button>
          <button ref={fullscreenButtonRef} type="button" className="button-secondary" onClick={enterFullscreen}>{COPY.fullscreen}</button>
        </nav>}

        {viewMode === 'normal' && (storageMessage || operationMessage) && <p className="status-line" role="status">{storageMessage || operationMessage}</p>}
      </main>

      {panelOpen && viewMode === 'normal' && <button className="mobile-panel-scrim" type="button" aria-label={COPY.closeSettings} onClick={closeSettings} />}
      {dialog && <PresetDialog dialog={dialog} onClose={closeDialog} onSubmit={submitDialog} onNameChange={(name) => setDialog((current) => current && ('name' in current ? { ...current, name } : current))} error={dialogError} busy={dialogBusy} />}
    </div>
  );
}
