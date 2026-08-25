# Interactive CMYK Moiré

Interactive generative art for exploring layered cyan, magenta, yellow, and black moiré patterns in the browser.

The app is local-first: the artwork is rendered with WebGL2 and GLSL ES 3.00, current settings and named presets are stored in IndexedDB, and the PWA cache contains static application assets only.

## Features

- Four independently displaced CMYK layers using a GLSL fragment shader with screen-style blending and a K-channel dark layer.
- Seeded per-layer flow profiles with controlled coordinate, noise-phase, time-phase, and displacement differences.
- `Flow line`, `Dot`, and `Flow line + Dot` render modes.
- Mouse, touch, pen, and keyboard pointer interaction with animated Flow line deformation.
- Play/pause, reduced-motion support, randomization, reset, and PNG export.
- Built-in presets including Evening Moiré, Cyan Drift, Ink Bloom, and Dotmatrix Interpolation.
- Named preset management: list, create, load, overwrite, rename, and delete.
- Built-in presets are read-only; saved preset names may be duplicated.
- Responsive settings UI with a desktop side panel and mobile bottom sheet at the 768px breakpoint.
- Fullscreen Canvas view and standalone-PWA Canvas view.
- Installable PWA with offline support for static assets.
- All in-app copy is English.

## Requirements

- Node.js 20 or later
- A modern browser with WebGL2, IndexedDB, and Service Worker support

## Development

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. The development server does not enable the production Service Worker; use the preview command to verify the built PWA behavior.

## Verification

```bash
npm test
npm run build
npm run preview
```

The unit tests cover parameter normalization and boundaries, Unicode preset-name validation, preset snapshots, renderer mathematics, WebGL shader-source invariants, framebuffer row flipping, and adaptive render quality. The implementation has also been checked in a PC browser for WebGL2 initialization, the initial artwork, preset CRUD dialogs, unsaved-change loading, PNG export, Fullscreen, the 768px/769px responsive boundary, and production-preview Service Worker registration.

Real smartphone-device testing is intentionally left to the project owner.

## Rendering performance

- A single full-screen fragment shader evaluates the warped line and dot fields in parallel on the GPU.
- The presentation Canvas keeps a stable pixel size while quality changes are rendered into an internal WebGL2 framebuffer.
- GLSL FBM octave contribution and internal render resolution adapt to sustained frame-time pressure.
- Adaptive quality keeps CSS-pixel/world-space pattern spacing stable while reducing GPU workload.
- Old and new internal framebuffers crossfade over 350ms to avoid abrupt visual jumps or apparent zooming.
- Layout and fullscreen resizes settle briefly before the presentation framebuffer is rebuilt, then transition from the previous image.
- Pointer deformation strength fades out independently after release or cancellation, avoiding an abrupt change at the end of an interaction.
- Shader animation time remains monotonic across `2π` boundaries, avoiding periodic time-wrap jumps in high-contrast presets such as Ink Bloom.
- A paused canvas renders on input, settings changes, and pointer settling instead of running an idle animation loop.
- Hidden tabs stop rendering and do not accumulate hidden elapsed time.
- PNG export renders into a temporary WebGL2 framebuffer and converts the readback with a temporary Canvas 2D surface.
- WebGL2 capability, shader initialization, and context-loss errors are surfaced in English UI copy.

## Storage and privacy

- `interactive-cmyk-moire` IndexedDB stores the current workspace and up to 100 user presets.
- Settings are saved with a short debounce so interaction remains responsive.
- Cache Storage is used only for static PWA assets and does not contain settings or presets.
- OPFS is kept as a possible future option for larger export or workspace data; it is not required by the MVP.
- No network service or account is required for artwork creation.

## Project structure

```text
src/
  App.tsx                    React UI and interaction state
  constants.ts               UI copy, defaults, layer definitions, ranges
  domain/                    Settings and preset rules
  persistence/               IndexedDB repository
  render/                    WebGL2 renderer, GLSL shader, and quality controller
  styles.css                 Tailwind CSS entry point and responsive styles
public/
  manifest.webmanifest       PWA metadata
  sw.js                      Static-asset Service Worker
```

## License

No license has been selected yet.
