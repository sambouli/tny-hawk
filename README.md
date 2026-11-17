# 🛹 TONY HAWK: NYC — Skate the City

A self-contained Three.js skateboarding game set in a procedurally generated New
York. One file, no build step required to play, zero external assets or network
calls — open `index.html` in any modern browser and skate.

## Play

Open [`index.html`](index.html) in a browser (double-click, or serve it:
`python3 -m http.server`). Works with keyboard on desktop and touch controls on
mobile.

### Controls

| Key | Action |
| --- | --- |
| `W A S D` | push · carve · brake |
| `SPACE` | ollie |
| `Q` / `E` | kickflip · heelflip |
| `⇧ + Q/E` | shove-it · 360 shove |
| `F` / `G` | FS 180 · FS 360 |
| `C` (hold) | manual |
| `H` (hold) | handplant on a ledge |
| `Esc` / `P` | pause |

Roll into a rail or ledge while airborne to grind; land tricks clean to bank
combo points. Every "NEW CITY" generates a different Manhattan.

## Architecture

The whole game ships as one inline `<script>` inside `index.html`. It is split
into two logical halves:

- **CORE** (`src/core.js`) — pure logic, zero DOM references: world generation,
  geometry, physics (`step`), collision, tricks, grinding, scoring, camera math,
  HUD layout, input mapping. Exposed as `window.CORE` so it can be unit-tested
  headlessly under Node.
- **RENDER + GAME SHELL** (`src/render.js`) — the Three.js scene, meshes,
  materials, lighting/shadows, particles, HUD DOM, RAF loop, and touch controls.
  Guarded by `if (typeof document !== 'undefined')` so the file loads under Node.

Three.js is vendored (`vendor/three.inline.js`) and inlined at build time.

## Build & test

```bash
node build.js      # reassemble index.html from src/ + vendor/ (refuses to emit if it won't parse)
node test/run.js   # headless suite against the SHIPPING code (world gen, physics, tricks, grind, bot sim, HUD layout)
```

The builder concatenates `vendor/three.inline.js` + `src/core.js` + `src/render.js`
into the template's single `<script>`, gated by a V8 parse check so a corrupted
part can never ship.

### Tests cover

- World-build determinism (same seed → bit-identical) and NaN hygiene
- Geometry helpers (`closestOnSeg`, `wrapAngle`, `angDist`)
- Surface sampling and wall collision (buildings are solid)
- Ollie / gravity / landing, trick start/reject, combo value
- Rail grinding (catch window, height lock, off-rail safety)
- A 90-second bot sim per seed that seeks rails, lands flips, scores, and stays finite
- Camera stability and HUD rect disjointness across phone/tablet/desktop aspect ratios
- Keyboard input mapping

## Notes

- Physics runs at a fixed timestep for determinism; the render loop clamps `dt`
  to survive tab-switches.
- A uniform spatial hash accelerates surface/wall/grind queries over ~4k segments.
- Buildings store half-extents (`hw`/`hd`); mesh scaling must double them.

## License

MIT.
