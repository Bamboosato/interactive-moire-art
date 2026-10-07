# Interactive CMYK Moiré

Interactive generative art for exploring layered cyan, magenta, yellow, and black moiré patterns in the browser.

The app is local-first: the artwork is rendered with WebGL2 and GLSL ES 3.00, current settings and named presets are stored in IndexedDB, and the PWA cache contains static application assets only.

## Features

- Four independently displaced CMYK layers using a GLSL fragment shader with screen-style blending for C/M/Y and a K-channel dark layer. Each layer can be shown or hidden; colors and flow profiles are fixed.
- Seeded per-layer flow profiles with controlled coordinate, noise-phase, time-phase, and displacement differences.
- `Flow line`, `Dot`, and `Flow line + Dot` render modes.
- Mouse, touch, pen, and keyboard pointer interaction with animated Flow line deformation.
- Play/pause, reduced-motion support, randomization, reset, and PNG export.
- Built-in presets including Evening Moiré, Cyan Drift, Ink Bloom, and Dotmatrix Interpolation.
- Named preset management: list, create, load, overwrite, rename, and delete.
- Built-in presets are read-only; saved preset names may be duplicated.
- Responsive settings UI with a desktop side panel and mobile bottom sheet at the 768px breakpoint.
- Fullscreen Canvas view, with an in-page Canvas view when the Fullscreen API is unavailable or rejected.
- PWA manifest and static-asset offline caching. Installation and display mode depend on the browser; installed launches retain the normal app UI.
- All in-app copy is English.

## Requirements

- Node.js `^20.19.0 || >=22.12.0`, matching the Vite and React plugin requirements in `package-lock.json`.
- A modern browser with WebGL2 for artwork rendering and IndexedDB for persistent settings and presets.
- HTTPS or localhost, plus Service Worker and Cache Storage support, for PWA caching. Rendering does not require a Service Worker.

## Development

```bash
npm ci
npm run dev
```

Open the local URL printed by Vite. The development server does not enable the production Service Worker; use the preview command to verify the built PWA behavior.

## Using the app

- Open **Settings** on screens up to 768 CSS pixels wide; the side panel is visible from 769 pixels upward.
- Choose a render mode, adjust the seven sliders, and toggle C/M/Y/K visibility. Hidden layers are allowed, including an all-hidden black canvas.
- Press and drag on the canvas with a mouse, or interact with touch/pen. Focus the canvas and use arrow keys to move the interaction point by 5% of its width/height; **Home** clears the interaction and recenters it.
- **Pause** stops artwork time advancement; settings changes and pointer interaction still render. Reduced-motion preference starts playback paused and pauses it when the preference becomes active. **Play** can resume it manually.
- **Randomize** changes the mode, parameters, and seed, preserving layer visibility unless all layers are hidden, in which case it enables all four.
- **Reset** immediately restores defaults, time, pointer, and preset tracking, and resumes playback unless reduced motion is requested. It does not delete saved presets.
- **Fullscreen** hides app controls. **Exit** returns to the normal UI; native fullscreen can also be exited using the browser's fullscreen controls.
- **Save PNG** exports an opaque image of the artwork at the canvas presentation dimensions, without app controls. Its filename is `interactive-cmyk-moire_YYYYMMDD_HHMMSS.png` using local time. Export dimensions are capped by the renderer; there is no custom-size or vector export.

## Presets

Choosing a preset in the list loads it immediately unless changes to a previously loaded or saved preset require confirmation. **Load** also loads the selected entry. The **Unsaved changes** indicator compares current settings with that preset's snapshot; it does not mean workspace autosave failed. Changes made before a preset has been loaded or saved do not trigger this confirmation.

**Save as New** creates a separate snapshot. **Overwrite** and **Delete** require confirmation; **Rename** changes the name without saving current artwork changes into the preset. These three actions are disabled for built-in presets. Deleting a preset leaves current artwork settings in place.

There can be up to 100 stored user presets, separate from the four built-in presets. Names are trimmed, duplicates are permitted, and domain validation accepts 1–64 Unicode code points. The dialog input also has the browser's `maxlength="64"` constraint, which counts UTF-16 code units and can limit emoji names sooner. Saved entries are ordered by latest update first.

Presets save parameters, the seed, and layer visibility, rather than an exact animation frame. Elapsed time, pointer state, viewport size, and adaptive render quality can change the resulting image.

## Verification

```bash
npm test
npm run build
npm run preview
```

The checked-in unit tests cover parameter normalization and boundaries, legacy settings conversion, Unicode preset-name validation, preset snapshots, seeded noise, animation-clock continuity, render-size calculations, WebGL shader-source invariants, framebuffer row flipping, and adaptive render quality. They do not run a real WebGL context, IndexedDB transactions, React UI, or a Service Worker.

Browser checks are manual; no browser E2E suite or browser-validation report is checked in. Unit-test success does not establish smartphone compatibility, PWA installation, offline readiness, or GPU rendering correctness. See [verification scope and manual scenarios](docs/verification.md) for prerequisites, intended checks, and the latest audit scope.

## Rendering performance

- A single full-screen fragment shader evaluates the warped line and dot fields in parallel on the GPU.
- The presentation Canvas keeps a stable pixel size while quality changes are rendered into an internal WebGL2 framebuffer.
- GLSL FBM octave contribution and internal render resolution adapt to sustained frame-time pressure.
- Adaptive quality keeps CSS-pixel/world-space pattern spacing stable while reducing GPU workload.
- Old and new internal framebuffers crossfade over 350ms to avoid abrupt visual jumps or apparent zooming.
- Layout and fullscreen resizes settle briefly before the presentation framebuffer is rebuilt, then transition from the previous image.
- Pointer deformation strength fades out independently after release or cancellation, avoiding an abrupt change at the end of an interaction.
- Shader animation time remains monotonic across `2π` boundaries, avoiding periodic time-wrap jumps in high-contrast presets such as Ink Bloom.
- A paused canvas renders on input, settings changes, pointer settling, and framebuffer transitions. With an inactive, settled pointer and no pending transition, the loop stops. An active interaction can keep requesting frames while paused; setting Speed to zero does not pause the loop.
- Hidden tabs stop rendering and do not accumulate hidden elapsed time.
- PNG export renders into a temporary WebGL2 framebuffer and converts the readback with a temporary Canvas 2D surface.
- WebGL2 capability, shader initialization, and context-loss errors are surfaced in English UI copy.

The presentation canvas and PNG size use a device pixel ratio capped at 2, a maximum long side of 4096 pixels, and a maximum area of 4,194,304 pixels. Adaptive rendering uses internal scale tiers of 1, 0.75, and 0.5 while keeping presentation dimensions stable. These are workload controls, not a guaranteed frame rate across devices.

## Storage and privacy

- `interactive-cmyk-moire` IndexedDB stores the current workspace and up to 100 user presets.
- Parameter changes are saved after a 300ms debounce. Workspace restoration does not replace settings already changed during startup.
- Only render settings are persisted. Playback, elapsed time, pointer state, selected preset, dirty tracking, and open panels/dialogs are not restored.
- Storage is local to the browser profile and origin; clearing site data removes it. There is no preset/workspace backup, import, export, or cross-device synchronization. PNG export does not back up editable settings.
- Storage errors are reported in the UI; rendering can continue in memory. Pending autosave is not explicitly flushed on page exit, so wait for **Saved** before closing after a change.
- Cache Storage is used only for static PWA assets and does not contain settings or presets.
- OPFS is not implemented.
- No network service or account is required for artwork creation.

## PWA and hosting

Deploy the contents of `dist/` to the root of a dedicated origin. The HTML, manifest icons, Service Worker registration, and asset-cache routing use root paths; hosting under a subdirectory is not currently configured.

The production Service Worker precaches the app shell, manifest, and icons. Built JavaScript/CSS assets are cached on demand after a controlled page requests them. For offline use, first load the production app online, allow registration, reload under Service Worker control, and ensure the required assets have loaded and cached. A first visit offline cannot initialize the app. Navigations try the network first and fall back to cached HTML on network failure; built assets, manifest, and icons use cache-first routing. Other origins and non-GET requests are not cached.

When a new worker is waiting, the normal UI shows **A new version is available. Reload.** The button activates the waiting worker and reloads after controller change, with a two-second fallback. Static-content changes need a Service Worker cache-version update so cache-first entries are refreshed. Activation deletes every Cache Storage cache whose name differs from the current app cache, so this implementation should not share its origin with another app that uses Cache Storage.

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
docs/
  architecture.md            Implemented behavior, data model, and rendering design
  verification.md            Test perspectives, coverage, and manual scenarios
```

## Design documentation

[Architecture and implemented behavior](docs/architecture.md) describes the current implementation and its limits. [Verification](docs/verification.md) maps the test perspectives to existing automation and manual checks. These documents describe implemented behavior; they are not a roadmap or a claim that every scenario has been executed.

## License

No license has been selected yet.
