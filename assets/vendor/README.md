# Vendored libraries

Pinned third-party files. The version is in each filename so the browser
cache can never serve a stale copy: to upgrade, add the new files under a new
name and update the reference, never overwrite in place.

| File | Name | Version | Source | License |
|---|---|---|---|---|
| `lenis-1.3.26.min.js` | Lenis | 1.3.26 | npm `lenis@1.3.26`, `dist/lenis.min.js` (via `npm pack`) | MIT license |
| `lenis-1.3.26.css` | Lenis | 1.3.26 | npm `lenis@1.3.26`, `dist/lenis.css` (via `npm pack`) | MIT license |
| `three-0.170.0.module.min.js` | three.js | 0.170.0 | npm `three@0.170.0`, `build/three.module.min.js` (via `npm pack`) | MIT license (header in the file) |
| `rapier3d-compat-0.14.0.es.js` | Rapier 3D (compat build, WASM embedded) | 0.14.0 | npm `@dimforge/rapier3d-compat@0.14.0`, `rapier.es.js` (via `npm pack`) | Apache License 2.0, copy in `rapier3d-compat-0.14.0.LICENSE.txt` |

Lenis: the pages listed under Scrolling in DESIGN.md. three.js and Rapier: the homepage lanyard badge only (`assets/js/lanyard.js`).
