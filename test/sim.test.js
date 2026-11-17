'use strict';
const { C, section, ok } = require('./harness.js');

section('bot sim: 90s of skating, no NaN, no sink');
{
  const seeds = [7, 4242, 88888];
  for (const sd of seeds) {
    const w = C.buildWorld(sd);
    const p = C.makePlayer(w);
    const rnd = C.mulberry32(sd ^ 0x51ed);
    const inp = C.makeInput();
    let maxAir = 0, grinds = 0, wasGrind = false, flips = 0;
    let minY = 1e9, steps = 0;
    const t0 = Date.now();
    // Pre-pick grind targets so the bot behaves like a player who spots a rail,
    // rolls at it and ollies -- a purely random walker almost never lands on a
    // ~0.5-unit-wide bar by luck, which would hide real regressions.
    const railTargets = w.segs.filter(s => s.kind === 'grind' && s.len2 > 100);
    let target = null, targetAge = 0;
    function pickTarget() {
      if (!railTargets.length) return;
      let best = null, bd = 1e18;
      for (const seg of railTargets) {
        const mx = (seg.ax + seg.bx) / 2, mz = (seg.az + seg.bz) / 2;
        const d = (mx - p.x) * (mx - p.x) + (mz - p.z) * (mz - p.z);
        if (d < bd) { bd = d; best = seg; }
      }
      target = best; targetAge = 0;
    }
    pickTarget();
    for (let i = 0; i < 60 * 90; i++) {
      const r = rnd();
      let seekJump = false;
      if (target) {
        const mx = (target.ax + target.bx) / 2, mz = (target.az + target.bz) / 2;
        const dx = mx - p.x, dz = mz - p.z;
        const dist = Math.hypot(dx, dz);
        const wantHeading = Math.atan2(dz, dx);
        const diff = C.angDist(wantHeading, p.heading);
        inp.left = diff > 0.12; inp.right = diff < -0.12;
        inp.fwd = true; inp.back = false;
        if (dist < 3.2 && p.state === 'roll') seekJump = true;
        if (dist < 2.0 || targetAge > 60 * 12) pickTarget();
        targetAge++;
      } else {
        inp.left = rnd() < 0.28; inp.right = rnd() < 0.28;
      }
      if (!target) { inp.fwd = r < 0.82; inp.back = r > 0.94; }
      inp.manual = rnd() < 0.18;
      inp.jump = seekJump || (i % 97) < 2;
      if ((i % 61) === 0 && p.state === 'air') {
        const pool = ['kickflip', 'heelflip', 'fs180', 'fs360', 'shove', 'bs180'];
        if (C.startTrick(p, pool[(rnd() * pool.length) | 0])) flips++;
      }
      C.step(p, w, 1 / 60, inp);
      steps++;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z) || !Number.isFinite(p.vx)) {
        ok(false, 'NaN at step ' + i + ' seed ' + sd); break;
      }
      minY = Math.min(minY, p.y);
      maxAir = Math.max(maxAir, p.airTime || 0);
      if (p.state === 'grind' && !wasGrind) grinds++;
      wasGrind = p.state === 'grind';
      if (p.x > w.bounds.x1 + 140) { p.x = w.spawn.x; p.z = w.spawn.z; p.y = 0.09; p.vy = 0; p.state = 'roll'; }
    }
    const ms = Date.now() - t0;
    ok(minY > -1.0, 'seed ' + sd + ': never sinks below ground', minY.toFixed(2));
    ok(grinds >= 1, 'seed ' + sd + ': bot found grinds', grinds);
    ok(flips >= 1, 'seed ' + sd + ': bot landed flips', flips);
    ok(p.score > 0, 'seed ' + sd + ': bot scored', p.score);
    ok(ms / steps < 0.12, 'seed ' + sd + ': physics per-step within budget', (ms / steps).toFixed(4) + 'ms');
    console.log('   seed ' + sd + ' -> score ' + p.score + ', grinds ' + grinds + ', flips ' + flips +
      ', lands ' + p.lands + ', bails ' + p.bails + ', maxAir ' + maxAir.toFixed(2) + 's, ' + ms + 'ms/' + steps + ' steps');
  }
}

section('camera');
{
  const w = C.buildWorld(7);
  const p = C.makePlayer(w);
  const cam = { x: p.x - 8, y: 6, z: p.z - 8, lx: p.x, ly: 1, lz: p.z, fov: 62 };
  C.updateCamera(cam, p, 1 / 60);
  ok(Number.isFinite(cam.x) && Number.isFinite(cam.y) && Number.isFinite(cam.z), 'camera stays finite', JSON.stringify(cam));
}

section('HUD layout disjointness across aspect ratios');
{
  const sizes = [[390, 844], [844, 390], [320, 568], [768, 1024], [1280, 720]];
  for (const [vw, vh] of sizes) {
    const touch = vw < 500 || Math.min(vw, vh) < 500;
    const L = C.hudLayout(vw, vh, touch);
    const rects = [...(L.panels || []), ...(L.controls || [])].filter(r => r.w > 0 && r.h > 0);
    // every rect on-screen
    let offscreen = rects.filter(r => r.x < -0.5 || r.y < -0.5 || r.x + r.w > vw + 0.5 || r.y + r.h > vh + 0.5);
    ok(offscreen.length === 0, vw + 'x' + vh + ': all rects on-screen', JSON.stringify(offscreen[0]));
    // controls do not overlap each other
    const cs = L.controls || [];
    let ctrlOverlap = 0;
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++)
      if (C.rectsOverlap(cs[i], cs[j])) ctrlOverlap++;
    ok(ctrlOverlap === 0, vw + 'x' + vh + ': controls disjoint', ctrlOverlap);
  }
}

section('input mapping');
{
  const inp = C.makeInput();
  C.keyDown(inp, 'KeyW');
  ok(inp.fwd === true, 'KeyW sets fwd');
  C.keyUp(inp, 'KeyW');
  ok(inp.fwd === false, 'KeyW up clears fwd');
  C.keyDown(inp, 'Space');
  ok(inp.jump === true, 'Space sets jump');
  C.keyUp(inp, 'Space');
}
