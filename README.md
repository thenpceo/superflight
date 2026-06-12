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
- **Sky** — custom stylized-sunset shader dome (violet → magenta → burning-orange gradient, layered sun
  halo, painterly banding), perpetual golden hour with a slowly creeping sun, warm-tinted billboard
  clouds, and a mountain ring silhouetted in the haze.
- **Lex Luthor** — rigged Justice League power-suit GLB with its own idle animations (mixer-driven),
  plus additive procedural gestures: the right arm sweeps overhead during throw telegraphs, and the
  hover platform banks/lunges/staggers. Green rim + thruster + point-light glow.
  AI: chase (catch-up boost when far), orbit-strafe at preferred range, telegraphed throws.
- **Building chunks** — ~52 m pieces of skyline (shared meshopt geometry) with green arc-lightning,
  kryptonite emissive, flickering glow + light. Dumb-fired at where you ARE at launch — straight line,
  fully dodgeable. Smoke burst + knockback + stumble on hit; street-impact shockwave plume.
- **Combat** — laser fires from the EYES toward the crosshair anywhere (lands on buildings with impact
  sparks), with 3.5 m sticky-aim snap onto Lex for damage; heat meter + overheat lockout. Punch: dash,
  hit-stop, shockwave ring, stagger. Health bars both sides; victory/defeat screens; Esc pauses
  (pointer-lock exit) with click-to-resume.
- **Character** — Ready Player Me avatar, RPM idle/falling clips + procedural Superman flight pose,
  verlet-cloth cape with shoulder-plane containment.
- **Post & feel** — bloom, grain, vignette, boost-reactive chromatic aberration, speed FOV zoom, camera
  shake, letterbox on boost, procedural wind/laser/impact audio, adaptive resolution scaling.
- **Music** — "Five Armies" by Kevin MacLeod (incompetech.com), licensed CC-BY 4.0; loops via WebAudio
  and ducks while paused.

The original World Labs Marble splat world from v1 lives in git history (`git log -- public/assets/world.spz`).
