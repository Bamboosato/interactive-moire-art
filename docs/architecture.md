# Architecture and implemented behavior

This document describes the implementation audited on 2026-10-06 against GitHub `main` at `6ed6ab0ce313d936721c8bfb10ed388c99c86065`. Runtime code was unchanged by the documentation audit. The [README](../README.md) is the user and development entry point; [verification](verification.md) describes coverage and checks.

## Responsibilities

| Source | Responsibility |
| --- | --- |
| [App.tsx](../src/App.tsx) | React controls, dialogs, preset state, debounced saves, playback, pointer smoothing, animation scheduling, fullscreen, PNG downloads, and worker update notification |
| [constants.ts](../src/constants.ts) / [types.ts](../src/types.ts) | English copy, default settings, fixed CMYK profiles, numeric limits, built-in presets, and record types |
| [validation.ts](../src/domain/validation.ts) / [presets.ts](../src/domain/presets.ts) | Normalization, legacy conversion, settings equality, name validation, randomization, and independent preset snapshots |
| [indexedDb.ts](../src/persistence/indexedDb.ts) | Database initialization, record validation, workspace loading/saving, preset CRUD, and ordering |
| [webglRenderer.ts](../src/render/webglRenderer.ts) | WebGL2 resource lifecycle, GLSL artwork and presentation passes, internal framebuffer sizes/transitions, and PNG capture |
| [qualityController.ts](../src/render/qualityController.ts) / [animationClock.ts](../src/render/animationClock.ts) | Adaptive quality and elapsed artwork time |
| [noise.ts](../src/render/noise.ts) / [flowField.ts](../src/render/flowField.ts) | CPU noise/flow helpers; noise has unit coverage, while flow helpers are not currently imported by the app or its tests. Runtime artwork uses GLSL |
| [styles.css](../src/styles.css) | Tailwind entry point, responsive layout, mobile settings sheet, canvas view, safe areas, and reduced CSS transitions |
| [sw.js](../public/sw.js) / [manifest.webmanifest](../public/manifest.webmanifest) | Static-asset caching and PWA metadata |

## Render settings

All numeric settings are finite and clamped during normalization. Missing/invalid values fall back to defaults. Slider steps constrain UI input; normalization does not generally round persisted values to those steps. The seed is floored to an integer and clamped to an unsigned 32-bit range.

| Setting / UI label | Default | Range | UI step |
| --- | --- | --- | --- |
| `mode` / Mode | `flowline` | `flowline`, `dot`, `hybrid` | Select |
| `lineSpacing` / Line spacing | 3.5 | 2–8 | 0.1 |
| `thickness` / Thickness | 0.8 | 0.4–1.6 | 0.1 |
| `noiseStrength` / Noise strength | 28 | 0–80 | 1 |
| `noiseScale` / Noise scale | 0.0045 | 0.0015–0.012 | 0.0001 |
| `interactionStrength` / Interaction strength | 52 | 0–120 | 1 |
| `influenceRadius` / Influence radius | 180 | 80–400 | 1 |
| `speed` / Speed | 0.18 | 0–1 | 0.01 |
| `randomSeed` | 1234567890 | 0–4294967295 | No direct input; changed by Randomize/presets |
| `layers.{c,m,y,k}.visible` | All `true` | Boolean | Checkboxes |

Spacing, thickness, deformation, and influence radius operate in CSS-pixel/world coordinates, so resolution changes do not intentionally scale pattern spacing. Thickness controls line width and also contributes to dot diameter. Layer colors, opacity, registration offsets, phase offsets, and displacement multipliers come from `LAYER_DEFINITIONS`; only visibility is editable per layer. C/M/Y use screen-style blending on black, and K darkens the accumulated color. Output alpha is always 1. This is an artistic shader, without print CMYK color management.

## UI and state transitions

The app starts with default render settings and normal view mode. Startup loads workspace and user presets asynchronously; a late workspace result is applied only if the user has not already changed settings. Startup playback depends on reduced-motion preference. A later change to reduced motion pauses playback; a change back does not automatically resume it.

| Action | State change |
| --- | --- |
| Change mode/slider/visibility | Normalize, render, schedule workspace save, compare with loaded preset snapshot if one exists |
| Select preset / Load | Apply immediately if clean; otherwise open a confirmation dialog. Loading updates preset tracking and workspace but preserves elapsed time and playback |
| Save as New | Save a settings snapshot with a UUID, then select and track it as clean |
| Overwrite | Confirm, then replace selected custom preset settings and update its timestamp; track it as clean |
| Rename | Validate trimmed name, preserve the preset's settings and creation time, update its timestamp |
| Delete | Confirm, remove selected custom entry, clear its tracking if loaded; preserve current artwork settings |
| Randomize | Generate mode, seed, and bounded parameters; keep existing layer visibility unless all layers are hidden, in which case enable all |
| Reset | Immediately restore defaults, zero elapsed time, clear pointer and preset tracking, and set playback from reduced-motion preference; saved presets remain |
| Pause / Play | Change time advancement; no persistence of playback state |
| Fullscreen | Request native fullscreen on the canvas stage; absent/rejected API falls back to an in-page canvas view |
| Exit | Leave native fullscreen or in-page view, return to normal UI |

`selectedPresetId` and `loadedPresetId` are distinct. Canceling a dirty-load dialog leaves the selected entry changed but preserves the artwork and loaded snapshot. Dirty state is settings equality against the loaded/saved snapshot, not an indication of workspace save status. Reloading the page restores parameters but does not restore preset identity or dirty state. Changes before any preset is loaded/saved do not prompt for confirmation. Built-in presets are immutable through the UI.

The mobile bottom sheet is used through 768 CSS pixels; the desktop side panel applies from 769 pixels. Close, backdrop, and Escape close the mobile sheet when no preset dialog is open. Dialogs disable submission/close controls while an operation is busy; failures keep the dialog open with an error. Name dialogs focus their input and dialog close restores trigger focus. There is no implemented dialog focus trap or dialog Escape handler.

Native fullscreen and in-page canvas view hide settings/actions and expose Exit. The manifest requests `fullscreen`, with `standalone` in `display_override`, but installed launch does not itself change React view mode; it retains normal UI. Installation and supported display modes require browser/device verification.

## Persistence

IndexedDB database `interactive-cmyk-moire` uses database version 2 and settings schema version 2. Neither Cache Storage nor localStorage stores render settings.

| Store | Key | Persisted fields |
| --- | --- | --- |
| `workspace` | `id: 'current'` | `schemaVersion`, `settings: RenderSettings`, `updatedAt` |
| `presets` | UUID `id` | Flattened `RenderSettings`, `name`, `builtIn: false`, `createdAt`, `updatedAt`, `schemaVersion` |

The presets store has a non-unique `updatedAt` index. Listing currently uses `getAll()`, validates records, and sorts by descending `updatedAt`, then descending ID on ties. Creating counts stored records and rejects creation at 100; invalid records hidden by validation still count toward this limit. Built-in presets are created from constants and do not occupy IndexedDB records. Names may duplicate because identity uses UUIDs. Names are trimmed and validated as 1–64 Unicode code points; the HTML input additionally caps UTF-16 code units at 64.

Reads accept schema 1 and 2. Schema 1 settings are normalized on read: `line` becomes `flowline`, `period` maps to line spacing at 0.25×, legacy thickness is scaled by 0.57, and `distortion` supplies noise/interaction values when modern fields are absent. New saves use schema 2; there is no bulk rewrite during startup. Unsupported versions are ignored. Malformed schema 2 settings cause a workspace to be ignored or a preset to be omitted; structurally valid finite numbers are subsequently clamped. Ignored records do not themselves produce an error banner.

Workspace updates use a 300ms trailing debounce. Save status progresses through Saving, Saved, then idle after 1600ms. There is no explicit page-exit flush. Settings changed just before closing may not persist. Only parameters, seed, and visibility persist; elapsed time, pointer/velocity, playback, view mode, panel/dialog state, render quality, selected preset, and dirty state remain in memory.

Storage failures leave rendering available in memory and show a storage message once per mounted app. Named-preset operation failures appear in their dialog. Storage is scoped to the browser profile and origin and can be removed by clearing site data. There is no cloud sync, backup/import/export of editable settings, OPFS implementation, or live synchronization between tabs. Multiple tabs can independently edit the same current-workspace record; no conflict-resolution UI exists.

## Rendering and interaction

WebGL2 and GLSL ES 3.00 are required; there is no Canvas 2D artwork fallback. A fullscreen fragment pass computes seeded warped lines/dots and composites four layers. A separate presentation pass draws the internal framebuffer and blends the previous texture during a transition. Layer profiles have fixed small offsets and controlled phase/displacement differences.

Pointer coordinates are normalized to 0–1 and velocity is bounded. Mouse input requires pressing/dragging; primary touch/pen input also updates the point. Release, mouse leave, cancellation, or Home recenters and deactivates the target. Arrow keys on the focused canvas move it in 0.05 steps, clamp at edges, and activate interaction. Position, strength, and velocity settle smoothly rather than snapping on release. Pointer deformation applies to all render modes through their displacement fields.

Playback advances shader time by `speed * deltaMs / 1000` with each delta capped at 50ms and no periodic time wrap. Hidden tabs cancel scheduled rendering; resumption uses a fresh timestamp, excluding hidden elapsed time. A paused canvas still renders requested changes, active/settling pointers, and framebuffer transitions. An inactive settled canvas stops requesting frames. Speed zero leaves playback enabled, so it still runs the frame loop.

Presentation size uses DPR clamped to 0.25–2, at most 4096 pixels on its long side and 4,194,304 total pixels. Internal quality scales that size by 1, 0.75, or 0.5. Pattern coordinates remain CSS-based. Quality samples a rolling window of up to 120 frame-rate samples, requires at least 30, and has a 3-second change cooldown. Average FPS below 40 for 2 seconds lowers one tier; at least 55 for 5 seconds raises one tier. Shader quality interpolates over 350ms, removing the fourth FBM octave at quality 0.75 or lower. Previous/new framebuffers also crossfade over 350ms. Layout resize uses an 80ms settle timer. Performance remains device/GPU dependent.

WebGL initialization failure and context loss display English errors. Loss releases resources; a browser context-restored event rebuilds resources and requests rendering, while restoration failure reports a shader error. These handlers need runtime GPU verification; shader-source tests do not validate recovery.

## PNG export

PNG capture renders current settings, elapsed time, pointer, and interpolated shader quality into a temporary framebuffer at presentation canvas dimensions. It reads RGBA pixels, flips bottom-up WebGL rows, and encodes with a temporary Canvas 2D surface. Export is opaque, excludes UI, and does not include editable settings metadata. During quality/framebuffer transitions it renders a fresh scene rather than capturing the blended presentation texture; it is not a promise of identical screen pixels.

The download uses `interactive-cmyk-moire_YYYYMMDD_HHMMSS.png` in local time. If the anchor lacks `download`, the code attempts an image tab and shows a long-press save hint; blocked opening or capture/encoding failures show an error. Actual saving/fallback behavior depends on the browser. There is no export-size selector, SVG export, or animation/video export.

## PWA and deployment

The Service Worker registers at `/sw.js` only in production, with `updateViaCache: 'none'`. Development mode does not register it. Deploy Vite's `dist/` at the origin root: HTML/manifest URLs and asset matching are root-based. HTTPS or localhost and supporting browser APIs are required for worker registration. Registration errors are currently swallowed, so absence of an error banner is not evidence of offline readiness.

The worker precaches the shell (`./`, `./index.html`), manifest, and three SVG icons. Navigations use network-first fetching and cached HTML on rejection. Same-origin `/assets/` files and the listed manifest/icons are cache-first and populate on successful requests; built JS/CSS are not precached at install time. Non-GET and cross-origin requests are ignored. Offline readiness requires a prior online visit under worker control with dependent assets loaded/cached. HTTP error responses do not trigger the navigation network-failure fallback.

Worker updates remain waiting until activation is requested. The normal UI detects a waiting/newly installed update and offers Reload; the button sends `SKIP_WAITING` and reloads on controller change or a two-second timeout. Activation claims clients and deletes every other Cache Storage cache. Use a dedicated origin and update `CACHE_NAME` when static content changes. Settings in IndexedDB are separate from this cache cleanup.

## Limits and verification

Automated coverage exercises domain and mathematical helpers and source invariants. It does not execute UI workflows, IndexedDB transactions, Service Worker lifecycle, or real WebGL rendering. Browser installation support, touch behavior, download behavior, accessibility focus behavior, storage failures/concurrency, and GPU performance require the targeted scenarios in [verification.md](verification.md). These limits are implementation/coverage boundaries, not a roadmap.
