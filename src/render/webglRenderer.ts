import { COPY, LAYER_DEFINITIONS, LAYER_KEYS } from '../constants';
import type { LayerKey, PointerState, RenderSettings } from '../types';
import { QUALITY_TRANSITION_MS } from './qualityController';

export const MAX_RENDER_LONG_SIDE = 4096;
export const MAX_RENDER_PIXELS = 4_194_304;

export type WebGLRendererStatus = 'ready' | 'context-lost' | 'shader-error';

export class WebGLRendererError extends Error {
  readonly code: 'unavailable' | 'shader';

  constructor(code: 'unavailable' | 'shader') {
    super(code === 'unavailable' ? COPY.webgl2Unavailable : COPY.webglShaderError);
    this.name = 'WebGLRendererError';
    this.code = code;
  }
}

export interface InternalRenderSize {
  width: number;
  height: number;
  scale: number;
}

export function calculateInternalRenderSize(
  cssWidth: number,
  cssHeight: number,
  devicePixelRatio: number,
  quality: number,
): InternalRenderSize {
  const width = Math.max(1, Number.isFinite(cssWidth) ? cssWidth : 1);
  const height = Math.max(1, Number.isFinite(cssHeight) ? cssHeight : 1);
  const dpr = Math.min(2, Math.max(0.25, Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1));
  const qualityScale = Math.min(1, Math.max(0.5, Number.isFinite(quality) ? quality : 1));
  const capByLongSide = MAX_RENDER_LONG_SIDE / Math.max(width, height);
  const capByPixels = Math.sqrt(MAX_RENDER_PIXELS / (width * height));
  const nativeScale = Math.min(dpr, capByLongSide, capByPixels);
  const scale = Math.max(Number.MIN_VALUE, nativeScale * qualityScale);
  return {
    width: Math.max(1, Math.min(MAX_RENDER_LONG_SIDE, Math.floor(width * scale))),
    height: Math.max(1, Math.min(MAX_RENDER_LONG_SIDE, Math.floor(height * scale))),
    scale,
  };
}

export function flipRgbaRows(source: Uint8Array, width: number, height: number): Uint8ClampedArray {
  const rowSize = width * 4;
  const target = new Uint8ClampedArray(source.length);
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = row * rowSize;
    const targetOffset = (height - row - 1) * rowSize;
    target.set(source.subarray(sourceOffset, sourceOffset + rowSize), targetOffset);
  }
  return target;
}

export const VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

out vec2 vUv;

void main() {
  vec2 position;
  if (gl_VertexID == 0) position = vec2(-1.0, -1.0);
  else if (gl_VertexID == 1) position = vec2(3.0, -1.0);
  else position = vec2(-1.0, 3.0);
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

export const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
precision highp int;

in vec2 vUv;
out vec4 outColor;

uniform vec2 uCssResolution;
uniform float uTime;
uniform vec4 uPointer;
uniform int uPointerActive;
uniform float uPointerStrength;
uniform float uLineSpacing;
uniform float uThickness;
uniform float uNoiseStrength;
uniform float uNoiseScale;
uniform float uInteractionStrength;
uniform float uInfluenceRadius;
uniform uint uSeed;
uniform int uMode;
uniform float uQuality;
uniform vec4 uLayerVisible;
uniform vec4 uLayerColor[4];
uniform vec4 uLayerProfile[4];
uniform float uLayerDisplacement[4];

const float PI = 3.14159265359;
const float TAU = 6.28318530718;

float fade(float value) {
  return value * value * (3.0 - 2.0 * value);
}

uint hash3(ivec3 point, uint seed) {
  uint value = uint(point.x) * 374761393u;
  value = (value + uint(point.y) * 668265263u) * 1274126177u;
  value = (value + uint(point.z) * 2147483647u) * 42595009u;
  value = (value ^ seed) * 1597334677u;
  value ^= value >> 16u;
  return value;
}

float random3(ivec3 point, uint seed) {
  return float(hash3(point, seed)) / 4294967295.0 * 2.0 - 1.0;
}

float valueNoise3D(vec3 point, uint seed) {
  ivec3 cell = ivec3(floor(point));
  vec3 fraction = fract(point);
  float fx = fade(fraction.x);
  float fy = fade(fraction.y);
  float fz = fade(fraction.z);
  float x00 = mix(random3(cell, seed), random3(cell + ivec3(1, 0, 0), seed), fx);
  float x10 = mix(random3(cell + ivec3(0, 1, 0), seed), random3(cell + ivec3(1, 1, 0), seed), fx);
  float x01 = mix(random3(cell + ivec3(0, 0, 1), seed), random3(cell + ivec3(1, 0, 1), seed), fx);
  float x11 = mix(random3(cell + ivec3(0, 1, 1), seed), random3(cell + ivec3(1, 1, 1), seed), fx);
  return mix(mix(x00, x10, fy), mix(x01, x11, fy), fz);
}

float fbm3D(vec3 point, uint seed) {
  float fourthOctaveWeight = smoothstep(0.5, 0.75, uQuality);
  float amplitude = 0.5;
  float frequency = 1.0;
  float value = 0.0;
  float amplitudeSum = 0.0;
  for (int octave = 0; octave < 4; octave += 1) {
    if (octave == 3 && uQuality <= 0.5) break;
    float octaveWeight = octave == 3 ? fourthOctaveWeight : 1.0;
    value += valueNoise3D(point * frequency, seed + uint(octave) * 1013u) * amplitude * octaveWeight;
    amplitudeSum += amplitude * octaveWeight;
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  return amplitudeSum > 0.0 ? value / amplitudeSum : 0.0;
}

float pointerInfluence(vec2 point) {
  if (uPointerActive == 0 || uPointerStrength <= 0.0 || uInteractionStrength <= 0.0) return 0.0;
  vec2 pointerPixel = uPointer.xy * uCssResolution;
  float radius = max(uInfluenceRadius, 1.0);
  float distanceToPointer = distance(point, pointerPixel);
  return (1.0 - smoothstep(0.0, radius, distanceToPointer)) * uPointerStrength;
}

vec2 flowDisplacement(vec2 point, vec4 profile, float displacementScale) {
  float scale = max(uNoiseScale, 0.00001);
  vec2 samplePoint = (point + profile.xy) * scale;
  float time = uTime * 0.18 + profile.w;
  uint layerSeed = uSeed + uint(max(profile.z, 0.0) * 10000.0);
  float primaryNoise = fbm3D(vec3(samplePoint, time), layerSeed);
  float secondaryNoise = fbm3D(
    vec3(samplePoint * 0.72 + vec2(13.7, -7.3), time * 0.8 + 4.1),
    layerSeed + 71u
  );
  float noiseStrength = uNoiseStrength * displacementScale;
  vec2 result = vec2(
    secondaryNoise * noiseStrength * 0.08,
    primaryNoise * noiseStrength
      + sin(point.x * 0.009 + point.y * 0.015 + uTime * 0.8 + profile.w)
        * noiseStrength * 0.12
  );
  float influence = pointerInfluence(point);
  if (influence <= 0.0) return result;
  vec2 pointerPixel = uPointer.xy * uCssResolution;
  vec2 delta = point - pointerPixel;
  float radius = max(uInfluenceRadius, 1.0);
  float distanceToPointer = length(delta);
  float interaction = uInteractionStrength * displacementScale;
  float radialDirection = cos(distanceToPointer / radius * TAU + uTime * 0.6);
  float radialWarp = radialDirection * interaction * 0.32 * influence;
  float dragX = clamp(uPointer.z * 0.025, -interaction * 0.35, interaction * 0.35) * influence;
  float dragY = clamp(uPointer.w * 0.025, -interaction * 0.35, interaction * 0.35) * influence;
  float swirl = clamp(delta.x / radius, -1.0, 1.0) * interaction * 0.18 * influence;
  result.x += dragX * 0.25;
  result.y += radialWarp + dragY + swirl;
  return result;
}

float lineMask(vec2 point, vec4 profile, float displacementScale, float lineWidth) {
  float spacing = max(uLineSpacing, 0.001);
  float warpedY = point.y + flowDisplacement(point, profile, displacementScale).y;
  float distanceToLine = abs(fract(warpedY / spacing) - 0.5) * spacing;
  float halfWidth = max(lineWidth * 0.5, 0.001);
  float antialias = max(fwidth(distanceToLine), 0.001);
  return 1.0 - smoothstep(halfWidth, halfWidth + antialias, distanceToLine);
}

float dotMask(vec2 point, vec4 profile, float displacementScale, float diameter) {
  float spacing = max(uLineSpacing, 0.001);
  vec2 cell = floor(point / spacing + 0.5) * spacing;
  vec2 center = cell + flowDisplacement(cell, profile, displacementScale);
  float radius = max(diameter * 0.5, 0.001);
  float antialias = max(fwidth(point.x), fwidth(point.y));
  return 1.0 - smoothstep(radius, radius + max(antialias, 0.001), distance(point, center));
}

float channelMask(vec2 point, vec4 profile, float displacementScale) {
  if (uMode == 0) return lineMask(point, profile, displacementScale, uThickness);
  if (uMode == 1) return dotMask(point, profile, displacementScale, min(uLineSpacing * 0.72, uThickness * 3.0));
  float line = lineMask(point, profile, displacementScale, uThickness * 0.75);
  float dot = dotMask(point, profile, displacementScale, min(uLineSpacing * 0.60, uThickness * 2.4));
  return min(1.0, line + dot);
}

void main() {
  vec2 point = vec2(vUv.x, 1.0 - vUv.y) * uCssResolution;
  vec3 composite = vec3(0.0);
  for (int layer = 0; layer < 4; layer += 1) {
    if (uLayerVisible[layer] < 0.5) continue;
    float mask = channelMask(point, uLayerProfile[layer], uLayerDisplacement[layer]);
    float alpha = clamp(mask * uLayerColor[layer].a, 0.0, 1.0);
    if (layer == 3) {
      composite *= 1.0 - alpha;
    } else {
      vec3 source = uLayerColor[layer].rgb * alpha;
      composite = 1.0 - (1.0 - composite) * (1.0 - source);
    }
  }
  outColor = vec4(clamp(composite, 0.0, 1.0), 1.0);
}`;

export const PRESENT_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uCurrentTexture;
uniform sampler2D uPreviousTexture;
uniform float uBlend;

void main() {
  vec4 current = texture(uCurrentTexture, vUv);
  vec4 previous = texture(uPreviousTexture, vUv);
  outColor = mix(previous, current, clamp(uBlend, 0.0, 1.0));
}`;

interface Uniforms {
  cssResolution: WebGLUniformLocation | null;
  time: WebGLUniformLocation | null;
  pointer: WebGLUniformLocation | null;
  pointerActive: WebGLUniformLocation | null;
  pointerStrength: WebGLUniformLocation | null;
  lineSpacing: WebGLUniformLocation | null;
  thickness: WebGLUniformLocation | null;
  noiseStrength: WebGLUniformLocation | null;
  noiseScale: WebGLUniformLocation | null;
  interactionStrength: WebGLUniformLocation | null;
  influenceRadius: WebGLUniformLocation | null;
  seed: WebGLUniformLocation | null;
  mode: WebGLUniformLocation | null;
  quality: WebGLUniformLocation | null;
  layerVisible: WebGLUniformLocation | null;
  layerColor: WebGLUniformLocation | null;
  layerProfile: WebGLUniformLocation | null;
  layerDisplacement: WebGLUniformLocation | null;
}

interface PresentUniforms {
  currentTexture: WebGLUniformLocation | null;
  previousTexture: WebGLUniformLocation | null;
  blend: WebGLUniformLocation | null;
}

interface RenderTarget {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
}

interface RenderTransition {
  previous: RenderTarget;
  startedAt: number;
}

type StatusListener = (status: WebGLRendererStatus, message?: string) => void;

function toRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new WebGLRendererError('shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) ?? 'unknown shader compilation error';
    gl.deleteShader(shader);
    if (import.meta.env.DEV) console.error(info);
    throw new WebGLRendererError('shader');
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, fragmentSource = FRAGMENT_SHADER_SOURCE): WebGLProgram {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
  let fragmentShader: WebGLShader | null = null;
  let program: WebGLProgram | null = null;
  try {
    fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    program = gl.createProgram();
    if (!program) throw new WebGLRendererError('shader');
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program) ?? 'unknown program link error';
      if (import.meta.env.DEV) console.error(info);
      throw new WebGLRendererError('shader');
    }
    return program;
  } finally {
    gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
    if (program && !gl.getProgramParameter(program, gl.LINK_STATUS)) gl.deleteProgram(program);
  }
}

function createRenderTarget(gl: WebGL2RenderingContext, width: number, height: number): RenderTarget {
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  if (!texture || !framebuffer) {
    if (framebuffer) gl.deleteFramebuffer(framebuffer);
    if (texture) gl.deleteTexture(texture);
    throw new WebGLRendererError('shader');
  }
  try {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('incomplete render target');
    }
    return { texture, framebuffer, width, height };
  } catch {
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
    throw new WebGLRendererError('shader');
  } finally {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }
}

function deleteRenderTarget(gl: WebGL2RenderingContext, target: RenderTarget | null): void {
  if (!target) return;
  gl.deleteFramebuffer(target.framebuffer);
  gl.deleteTexture(target.texture);
}

export class WebGLRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly onStatus?: StatusListener;
  private readonly onContextLost = (event: Event) => {
    event.preventDefault();
    this.contextLost = true;
    this.deleteResources();
    this.onStatus?.('context-lost', COPY.webglContextLost);
  };
  private readonly onContextRestored = () => {
    try {
      this.initializeResources();
      this.contextLost = false;
      this.onStatus?.('ready');
      this.resize(this.cssWidth, this.cssHeight, this.devicePixelRatio, this.quality);
    } catch {
      this.contextLost = true;
      this.onStatus?.('shader-error', COPY.webglShaderError);
    }
  };
  private readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram | null = null;
  private presentProgram: WebGLProgram | null = null;
  private vertexArray: WebGLVertexArrayObject | null = null;
  private uniforms: Uniforms | null = null;
  private presentUniforms: PresentUniforms | null = null;
  private renderTarget: RenderTarget | null = null;
  private transition: RenderTransition | null = null;
  private contextLost = false;
  private cssWidth = 1;
  private cssHeight = 1;
  private devicePixelRatio = 1;
  private quality = 1;

  constructor(canvas: HTMLCanvasElement, onStatus?: StatusListener) {
    this.canvas = canvas;
    this.onStatus = onStatus;
    const context = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!context) throw new WebGLRendererError('unavailable');
    this.gl = context;
    this.canvas.addEventListener('webglcontextlost', this.onContextLost, false);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored, false);
    try {
      this.initializeResources();
    } catch (error) {
      this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
      this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
      throw error instanceof WebGLRendererError ? error : new WebGLRendererError('shader');
    }
    this.gl.disable(this.gl.DEPTH_TEST);
    this.gl.disable(this.gl.BLEND);
    this.onStatus?.('ready');
  }

  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number, quality: number, timestamp = performance.now()): InternalRenderSize {
    this.cssWidth = Math.max(1, Number.isFinite(cssWidth) ? cssWidth : 1);
    this.cssHeight = Math.max(1, Number.isFinite(cssHeight) ? cssHeight : 1);
    this.devicePixelRatio = Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1;
    this.quality = Math.min(1, Math.max(0.5, Number.isFinite(quality) ? quality : 1));
    const presentationSize = calculateInternalRenderSize(this.cssWidth, this.cssHeight, this.devicePixelRatio, 1);
    const renderSize = calculateInternalRenderSize(this.cssWidth, this.cssHeight, this.devicePixelRatio, this.quality);
    const presentationChanged = this.canvas.width !== presentationSize.width || this.canvas.height !== presentationSize.height;
    let previousTarget: RenderTarget | null = null;
    if (presentationChanged) {
      if (this.transition) deleteRenderTarget(this.gl, this.transition.previous);
      this.transition = null;
      previousTarget = this.renderTarget;
      this.canvas.width = presentationSize.width;
      this.canvas.height = presentationSize.height;
      this.renderTarget = null;
    }
    const targetChanged = !this.renderTarget
      || this.renderTarget.width !== renderSize.width
      || this.renderTarget.height !== renderSize.height;
    if (!this.contextLost && targetChanged) {
      const nextTarget = createRenderTarget(this.gl, renderSize.width, renderSize.height);
      if (this.transition) deleteRenderTarget(this.gl, this.transition.previous);
      const targetToTransitionFrom = previousTarget ?? this.renderTarget;
      this.transition = targetToTransitionFrom
        ? { previous: targetToTransitionFrom, startedAt: timestamp }
        : null;
      this.renderTarget = nextTarget;
    }
    if (!this.contextLost) this.gl.viewport(0, 0, presentationSize.width, presentationSize.height);
    return renderSize;
  }

  get isTransitioning(): boolean {
    return this.transition !== null;
  }

  draw(settings: RenderSettings, elapsedTime: number, pointer: PointerState, visualQuality: number, timestamp = performance.now()): void {
    if (this.contextLost || !this.program || !this.vertexArray || !this.uniforms) return;
    const gl = this.gl;
    if (this.renderTarget) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.renderTarget.framebuffer);
      gl.viewport(0, 0, this.renderTarget.width, this.renderTarget.height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.drawScene(settings, elapsedTime, pointer, visualQuality);

      let previousTexture = this.renderTarget.texture;
      let blend = 1;
      if (this.transition) {
        blend = Math.min(1, Math.max(0, (timestamp - this.transition.startedAt) / QUALITY_TRANSITION_MS));
        previousTexture = this.transition.previous.texture;
        if (blend >= 1) {
          deleteRenderTarget(gl, this.transition.previous);
          this.transition = null;
          previousTexture = this.renderTarget.texture;
        }
      }
      this.present(this.renderTarget.texture, previousTexture, blend);
      return;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.drawScene(settings, elapsedTime, pointer, visualQuality);
  }

  async capturePng(settings: RenderSettings, elapsedTime: number, pointer: PointerState, visualQuality: number): Promise<Blob> {
    if (this.contextLost) throw new Error(COPY.webglContextLost);
    if (!this.program || !this.vertexArray || !this.uniforms) throw new Error(COPY.webglShaderError);

    const gl = this.gl;
    const width = Math.max(1, this.canvas.width);
    const height = Math.max(1, this.canvas.height);
    let texture: WebGLTexture | null = null;
    let framebuffer: WebGLFramebuffer | null = null;
    const previousViewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
    try {
      texture = gl.createTexture();
      framebuffer = gl.createFramebuffer();
      if (!texture || !framebuffer) throw new Error('Could not create the export framebuffer.');
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('The export framebuffer is incomplete.');
      }
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.drawScene(settings, elapsedTime, pointer, visualQuality);
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      if (gl.getError() !== gl.NO_ERROR) throw new Error('Could not read the export framebuffer.');
      return await rgbaToPngBlob(flipRgbaRows(pixels, width, height), width, height);
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.viewport(previousViewport[0], previousViewport[1], previousViewport[2], previousViewport[3]);
      if (framebuffer) gl.deleteFramebuffer(framebuffer);
      if (texture) gl.deleteTexture(texture);
    }
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    if (!this.contextLost) this.deleteResources();
  }

  private initializeResources(): void {
    this.deleteResources();
    const program = createProgram(this.gl);
    let presentProgram: WebGLProgram;
    try {
      presentProgram = createProgram(this.gl, PRESENT_FRAGMENT_SHADER_SOURCE);
    } catch (error) {
      this.gl.deleteProgram(program);
      throw error;
    }
    const vertexArray = this.gl.createVertexArray();
    if (!vertexArray) {
      this.gl.deleteProgram(program);
      this.gl.deleteProgram(presentProgram);
      throw new WebGLRendererError('shader');
    }
    this.gl.bindVertexArray(vertexArray);
    this.program = program;
    this.presentProgram = presentProgram;
    this.vertexArray = vertexArray;
    const get = (name: string) => this.gl.getUniformLocation(program, name);
    this.uniforms = {
      cssResolution: get('uCssResolution'),
      time: get('uTime'),
      pointer: get('uPointer'),
      pointerActive: get('uPointerActive'),
      pointerStrength: get('uPointerStrength'),
      lineSpacing: get('uLineSpacing'),
      thickness: get('uThickness'),
      noiseStrength: get('uNoiseStrength'),
      noiseScale: get('uNoiseScale'),
      interactionStrength: get('uInteractionStrength'),
      influenceRadius: get('uInfluenceRadius'),
      seed: get('uSeed'),
      mode: get('uMode'),
      quality: get('uQuality'),
      layerVisible: get('uLayerVisible'),
      layerColor: get('uLayerColor[0]'),
      layerProfile: get('uLayerProfile[0]'),
      layerDisplacement: get('uLayerDisplacement[0]'),
    };
    this.presentUniforms = {
      currentTexture: this.gl.getUniformLocation(presentProgram, 'uCurrentTexture'),
      previousTexture: this.gl.getUniformLocation(presentProgram, 'uPreviousTexture'),
      blend: this.gl.getUniformLocation(presentProgram, 'uBlend'),
    };
  }

  private deleteResources(): void {
    deleteRenderTarget(this.gl, this.renderTarget);
    if (this.transition) deleteRenderTarget(this.gl, this.transition.previous);
    if (this.vertexArray) this.gl.deleteVertexArray(this.vertexArray);
    if (this.program) this.gl.deleteProgram(this.program);
    if (this.presentProgram) this.gl.deleteProgram(this.presentProgram);
    this.renderTarget = null;
    this.transition = null;
    this.vertexArray = null;
    this.program = null;
    this.presentProgram = null;
    this.uniforms = null;
    this.presentUniforms = null;
  }

  private present(currentTexture: WebGLTexture, previousTexture: WebGLTexture, blend: number): void {
    if (!this.presentProgram || !this.vertexArray || !this.presentUniforms) return;
    const gl = this.gl;
    const uniforms = this.presentUniforms;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.presentProgram);
    gl.bindVertexArray(this.vertexArray);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, currentTexture);
    gl.uniform1i(uniforms.currentTexture, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, previousTexture);
    gl.uniform1i(uniforms.previousTexture, 1);
    gl.uniform1f(uniforms.blend, blend);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  private drawScene(settings: RenderSettings, elapsedTime: number, pointer: PointerState, visualQuality: number): void {
    if (!this.program || !this.vertexArray || !this.uniforms) return;
    const gl = this.gl;
    const uniforms = this.uniforms;
    const mode = settings.mode === 'flowline' ? 0 : settings.mode === 'dot' ? 1 : 2;
    const visible = LAYER_KEYS.map((key) => settings.layers[key].visible ? 1 : 0);
    const colors = LAYER_KEYS.flatMap((key) => {
      const profile = LAYER_DEFINITIONS[key];
      const [red, green, blue] = toRgb(profile.color);
      return [red, green, blue, profile.opacity];
    });
    const profiles = LAYER_KEYS.flatMap((key) => {
      const profile = LAYER_DEFINITIONS[key];
      return [profile.offsetX, profile.offsetY, profile.noisePhase, profile.timePhase];
    });
    const displacement = LAYER_KEYS.map((key) => LAYER_DEFINITIONS[key].displacementScale);
    const safeQuality = Math.min(1, Math.max(0.5, Number.isFinite(visualQuality) ? visualQuality : 1));
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vertexArray);
    gl.uniform2f(uniforms.cssResolution, this.cssWidth, this.cssHeight);
    gl.uniform1f(uniforms.time, Number.isFinite(elapsedTime) ? elapsedTime : 0);
    gl.uniform4f(uniforms.pointer, pointer.x, pointer.y, pointer.velocityX, pointer.velocityY);
    gl.uniform1i(uniforms.pointerActive, pointer.active ? 1 : 0);
    gl.uniform1f(uniforms.pointerStrength, Math.min(1, Math.max(0, Number.isFinite(pointer.strength) ? pointer.strength : 0)));
    gl.uniform1f(uniforms.lineSpacing, settings.lineSpacing);
    gl.uniform1f(uniforms.thickness, settings.thickness);
    gl.uniform1f(uniforms.noiseStrength, settings.noiseStrength);
    gl.uniform1f(uniforms.noiseScale, settings.noiseScale);
    gl.uniform1f(uniforms.interactionStrength, settings.interactionStrength);
    gl.uniform1f(uniforms.influenceRadius, settings.influenceRadius);
    gl.uniform1ui(uniforms.seed, settings.randomSeed >>> 0);
    gl.uniform1i(uniforms.mode, mode);
    gl.uniform1f(uniforms.quality, safeQuality);
    gl.uniform4fv(uniforms.layerVisible, visible);
    gl.uniform4fv(uniforms.layerColor, colors);
    gl.uniform4fv(uniforms.layerProfile, profiles);
    gl.uniform1fv(uniforms.layerDisplacement, displacement);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}

async function rgbaToPngBlob(pixels: Uint8ClampedArray, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Could not create the PNG conversion canvas.');
  context.putImageData(new ImageData(pixels, width, height), 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('PNG conversion timed out.')), 5000);
    canvas.toBlob((blob) => {
      window.clearTimeout(timeout);
      if (blob) resolve(blob);
      else reject(new Error('PNG conversion returned no data.'));
    }, 'image/png');
  });
}

export type { LayerKey };
