# SUPERFLIGHT — Showdown Over the City

Fly like Superman through a 4×9-tile instanced metropolis and take down **Lex Luthor**,
who chases you on a hover platform and hurls glowing chunks of a New York building at you.
Three.js + Vite, no game engine.

## Run it

```bash
npm install
npm run dev
```

| Input | Action |
|---|---|
| Mouse | Steer (pointer lock) |
| `W` / `Shift` | Fly / boost (~165 km/h) |
| `Space` / `C` / `S` | Rise / dive / brake |
| **Right-click** (or `F`) | Heat-limited red laser (aim near Lex — generous assist) |
| **Left-click** (or `E`) | Punch when the hint lights up (close range, heavy damage + stagger) |
| `R` | Restart after victory/defeat |

Debug: `?pose=1` pose inspector, `?nopost` disables post-processing. Dev console: `window.__game`, `window.__tick(n)`, `window.__pause`, `window.__freeCam`.

## How it's built

- **City** — `cityfbx.glb` (82 MB, 537 meshes) crunched to 3.8 MB with gltf-transform (meshopt + webp),
  merged into 6 geometry/material groups, rendered as a 4×9 grid of InstancedMesh → **6 draw calls,
  ~840k tris** for the whole skyline. Collision via `three-mesh-bvh` (one shared BVH, 36 invisible
  tile colliders; flight/camera rays only test the nearest tiles).
- **Sky** — three.js `Sky` shader with a ~5-minute day cycle (sun elevation/azimuth swing, never full night),
  sun-tracked directional + hemisphere lights, fog color sync, drifting billboard clouds,
  and a procedural ridge-ring of mountains on the horizon.
- **Lex Luthor** — rigged Justice League power-suit GLB with its own idle animations (mixer-driven),
  plus additive procedural gestures: the right arm sweeps overhead during throw telegraphs, and the
  hover platform banks/lunges/staggers. Green rim + thruster + point-light glow.
  AI: chase (catch-up boost when far), orbit-strafe at preferred range, telegraphed throws.
- **Building chunks** — one shared meshopt geometry; spin, green arc-lightning (jittered LineSegments),
  flickering glow + light; aimed at your *predicted* position; smoke burst + knockback + stumble on hit;
  fade-out once past you.
- **Combat** — laser: heat meter, overheat lockout, 20° aim-assist cone, additive core+glow beam from the
  leading fist; punch: dash, hit-stop, shockwave ring, stagger. Health bars both sides; victory/defeat
  screens with soft restart.
- **Character** — Ready Player Me avatar, RPM idle/falling clips + procedural Superman flight pose,
  verlet-cloth cape with shoulder-plane containment.
- **Post & feel** — bloom, grain, vignette, boost-reactive chromatic aberration, speed FOV zoom, camera
  shake, letterbox on boost, procedural wind/laser/impact audio, adaptive resolution scaling.

The original World Labs Marble splat world from v1 lives in git history (`git log -- public/assets/world.spz`).
