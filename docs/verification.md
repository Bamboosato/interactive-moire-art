# Verification scope and scenarios

This document records verification perspectives before detailed scenarios, identifies existing automation, and supplies reproducible manual checks. A listed scenario is not an execution result.

## Perspectives and priority

| Perspective | Normal behavior | Failure behavior | Boundaries | State transitions |
| --- | --- | --- | --- | --- |
| Functional | Modes, controls, presets, PNG | Unsupported WebGL, storage/export errors | Zero speed/interaction, hidden layers | Load/edit/save/delete/reset, play/pause, enter/exit view |
| Non-functional | Stable animation, local-only data, bounded GPU workload | Context loss, offline misses, slow storage | DPR/render-size limits, sustained low/high FPS | Visible/hidden, quality tiers, worker update, reduced motion |
| Data | Defaults, snapshots, workspace restore, ordering | Invalid records, unknown schema, failed transactions | Slider endpoints, 1/64-character names, 99/100 presets | Legacy reads, debounce completion, late startup reads, competing tabs |
| UI | English labels, keyboard/pointer controls, responsive layout | Errors are visible and operations recover | 768/769 CSS pixels, name-input limits | Sheet/dialog close, focus return, fullscreen fallback |

Highest priority is preventing loss or unintended replacement of saved settings/presets and failure to render/export the artwork (major impact). Storage failures, dirty-load confirmation, reset semantics, and startup timing deserve explicit checks. Frame-rate/display transitions and incorrect cache updates can substantially affect usability (major); spacing/copy issues with intact functionality are usually minor. A failure that prevents the app from loading or destroys all stored records should be treated as critical.

## Existing automated coverage

Run `npm ci`, then `npm test` and `npm run build` using the Node version range in the [README](../README.md). Build runs TypeScript checking and Vite production bundling. Tests are Vitest unit tests; there is no checked-in browser E2E script or browser matrix.

| Test file | Intent covered |
| --- | --- |
| [validation.test.ts](../src/domain/validation.test.ts) | Numeric limits/fallbacks, v1 normalization, trimmed Unicode name length, settings equality, randomized bounds |
| [presets.test.ts](../src/domain/presets.test.ts) | Valid independent built-in settings, custom snapshots/identity, fixed layer separation, conservative Ink Bloom parameters |
| [noise.test.ts](../src/render/noise.test.ts) | Deterministic bounded seeded noise, seed differences, and smooth nearby-coordinate changes |
| [animationClock.test.ts](../src/render/animationClock.test.ts) | Continuous time across 2π and safe handling of invalid timing inputs |
| [qualityController.test.ts](../src/render/qualityController.test.ts) | Sustained low-FPS reduction/cooldown, high-FPS recovery, interpolated visual quality |
| [webglRenderer.test.ts](../src/render/webglRenderer.test.ts) | Render-size limits, invalid dimension/quality fallback, RGBA row orientation, GLSL source invariants |

Shader-source tests check strings, not actual compilation or rendered pixels. CPU flow helpers have no direct automated coverage. There are no automated IndexedDB transaction, React interaction, browser download, PWA, or context-loss integration tests.

## Manual setup and evidence

1. Use a dedicated test browser profile/origin. Record commit, Node version, browser/version, OS, device/GPU, CSS viewport, DPR, reduced-motion setting, and network conditions. Do not clear an owner's production data to prepare a test.
2. Build, start `npm run preview`, and use the localhost URL. Establish a clean baseline in that test profile. For storage tests, prepare one saved workspace and at least two distinct user presets with known settings. Inspect the `interactive-cmyk-moire` database to verify data rather than relying solely on status copy.
3. Test one device sequentially. Keep a separate origin/profile for corrupt-record, quota/unavailable-storage, and worker-cache scenarios. Reset altered browser preferences/network/fault injection after each scenario.
4. Capture screenshots or screen recordings, console errors, IndexedDB records before/after, PNG dimensions/pixels, worker/cache status, and exact reproduction steps. Record expected versus actual behavior and whether a failure repeats from a clean baseline.
5. For intermittent failures, test timing hypotheses: late storage reads, closure before debounce, active pointer after pause, GPU quality changes during export, multiple tabs writing, and waiting-worker activation. Classify findings as missing test perspective, test-data problem, environment problem, or implementation problem before drawing conclusions.

## Manual scenarios

Each scenario states its prerequisite and intent. Run targeted cases based on the changed area and risk; do not default to every scenario for a documentation-only change.

| ID / class | Prerequisite and action | Verification intent / expected behavior |
| --- | --- | --- |
| F1 / Normal | Clean profile with WebGL2; open app, select each mode, vary sliders and C/M/Y/K visibility | Defaults render; settings affect artwork; all-hidden canvas is black and reports no visible layers |
| F2 / Normal + boundary | Canvas focused; press/drag mouse, interact with touch/pen, use arrows to edges, then Home/release/cancel | Mouse hover alone does not deform; keyboard moves 5% per key and clamps at edges; interaction fades and recenters rather than snapping |
| F3 / State | Load a preset, edit a slider, pause, interact, resume, set Speed to zero, then Reset | Dirty state follows parameters; pause stops time but allows interaction; Speed zero leaves playback loop enabled; Reset restores defaults/time/pointer/playback without deleting presets |
| D1 / Normal + timing | Known workspace and preset data; change settings, wait for Saved, reload; repeat with deliberately delayed startup reads and an early edit | Workspace persists after completion; preset identity/playback/time are not restored; late workspace load does not replace early user edits |
| D2 / State | Two user presets; load one, edit, select another, cancel then confirm; Save as New, rename, overwrite, delete | Cancel retains current artwork/loaded snapshot while list selection changes; confirmed load replaces settings; rename preserves stored settings; overwrite snapshots current settings; deletion preserves artwork; built-in mutation controls stay disabled |
| D3 / Boundary + failure | Dedicated profile with 99 stored custom presets; create the 100th, then attempt 101st. Try empty/whitespace/1/64-character names and emoji | 100 allowed; new creation beyond 100 reports an error; trimmed names accepted only at domain length 1–64; duplicate names allowed; HTML input's UTF-16 limit may constrain emoji earlier |
| D4 / Failure + migration | Isolated database with representative schema 1, valid/out-of-range schema 2, malformed schema 2, and unknown-version records | Legacy settings convert; valid finite out-of-range values clamp; malformed/unknown records are ignored rather than applied; next save writes schema 2; ignored stored presets still count toward creation limit |
| D5 / Failure + timing | Isolated profile; make IndexedDB unavailable or inject a rejected transaction, then try editing/saving presets; also close immediately after editing | Storage error is visible, rendering can continue in memory, failed dialog remains open; immediate close can lose pending autosave because there is no exit flush |
| D6 / Concurrency | Two tabs at the same test origin; edit workspace/presets sequentially and with overlapping timing | Record observed writes and stale UI; there is no live tab synchronization/conflict UI. Distinguish this limitation from loss in a single-tab save workflow |
| U1 / Boundary + state | Viewports 768 and 769 CSS pixels; open Settings, close with button/backdrop/Escape, open name dialog and close it | Bottom sheet versus side panel follows boundary; sheet Escape does not interfere with an open dialog; name input receives focus and close returns focus to trigger. Dialog focus trapping/Escape dismissal are not implemented |
| U2 / State + fallback | Normal browser; enter native fullscreen, exit with Exit/browser controls; repeat with absent/rejected Fullscreen API; launch installed PWA | Canvas view hides controls and Exit restores normal UI; failed API uses in-page view; installed launch retains normal UI, subject to browser display-mode support |
| N1 / State | Playback active; hide tab for a known interval, then return. Repeat paused with inactive settled pointer; enable reduced motion | Hidden interval does not advance artwork time; settled paused loop stops; enabling reduced motion pauses playback, disabling it does not auto-resume; manual Play still works |
| N2 / Load + boundary | Representative GPU/DPR/viewports, sustained performance pressure, repeated resize/fullscreen | Internal quality tiers change with hysteresis, crossfade and preserve CSS pattern scale; presentation size remains bounded; collect frame timing and visual evidence rather than asserting a universal FPS target |
| N3 / Failure + recovery | Dedicated profile; disable WebGL2 or simulate context loss/restoration | Unsupported initialization shows English error; loss shows error; successful restoration rebuilds resources and resumes rendering; failed restoration remains visibly errored |
| E1 / Normal + boundary | Small and high-DPR/large canvases; export all three modes while paused, then during playback/quality transition | PNG is opaque and correctly oriented at presentation dimensions within size caps; excludes UI; timestamp filename matches local time; preset seed alone is not an exact-frame guarantee |
| E2 / Failure + environment | Isolated browser setup with capture failure or no supported anchor download; block fallback tab when applicable | Failure reports an error; lacking download attempts image-tab/long-press path; actual device save behavior is recorded, not inferred from code |
| P1 / Normal + offline | Fresh preview profile online; wait for worker registration, reload under its control, wait for dependent assets to cache, then go offline and reload | Cached shell and required JS/CSS permit offline use; a fresh uncached offline profile cannot initialize. Save data remains in IndexedDB, not asset cache |
| P2 / Update + failure | Dedicated origin with an existing controlled page; serve changed build and changed cache name, trigger worker update, use Reload | Waiting worker notification appears in normal UI; activation/reload uses updated assets; settings remain; other Cache Storage names are removed by current worker. Registration failure is not visibly reported; inspect worker state |

For mobile changes, include a real touch device and its browser/PWA/download behavior. For fullscreen, worker, or GPU changes, include supporting and unsupported environments where practical. Cross-browser checks should target capability differences (for example Chromium and WebKit/Firefox), rather than claiming a fixed supported matrix without evidence. Run a connected load → edit → save → reload → overwrite → delete sequence to expose state/order-dependent problems after targeted checks.

## Documentation audit result — 2026-10-06

The local source and GitHub default branch matched `6ed6ab0ce313d936721c8bfb10ed388c99c86065`. At that revision README was the only tracked project document; no design document, browser E2E suite, or browser-validation report was present. The audit corrected the Node requirement and installed-PWA description, added usage/preset/storage/export/offline constraints, and introduced the architecture and verification documents. Runtime files were unchanged.

Validation on Windows with Node.js v24.13.0: `npm test` passed all 21 tests in six files, and `npm run build` passed TypeScript checking and Vite production bundling. Documentation links and the settings table were also checked against local targets/constants.

The audit scope is static implementation/document comparison, existing unit tests, TypeScript/production build, and documentation links/settings-table checks. Browser E2E scope is **not executed**: only Markdown documents changed, so there is no new runtime behavior requiring browser regression testing. Cross-browser, real mobile, GPU rendering, IndexedDB integration, downloads, installation, and offline/update scenarios remain unverified in this audit. Earlier README browser-check claims had no checked-in report and are not carried forward as current verification evidence.
