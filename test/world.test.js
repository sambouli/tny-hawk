'use strict';
const { C, section, ok } = require('./harness.js');

section('world build determinism');
{
  const w1 = C.buildWorld(7);
  const w2 = C.buildWorld(7);
  ok(w1.boxes.length === w2.boxes.length, 'same seed same box count', w1.boxes.length + '/' + w2.boxes.length);
  ok(JSON.stringify(w1.boxes) === JSON.stringify(w2.boxes), 'same seed bit-identical boxes');
  const w3 = C.buildWorld(4242);
  ok(JSON.stringify(w3.boxes.map(b => Math.round(b.x))) !== JSON.stringify(w1.boxes.map(b => Math.round(b.x))), 'different seeds diverge');
  // NaN hygiene (boxes store half-extents hw/hd)
  let nan = 0;
  for (const b of w1.boxes) for (const k of ['x', 'z', 'h', 'hw', 'hd', 'top']) if (!Number.isFinite(b[k])) nan++;
  for (const s of w1.segs) for (const k of ['ax', 'az', 'bx', 'bz', 'top']) if (!Number.isFinite(s[k])) nan++;
  ok(nan === 0, 'no NaN in world geometry', nan);
  ok(w1.boxes.some(b => b.kind === 'building' || b.kind === 'landmark'), 'has buildings');
}

section('geometry helpers');
{
  const s = { ax: 0, az: 0, bx: 10, bz: 0, dx: 10, dz: 0, len2: 100, top: 1 };
  const c = C.closestOnSeg(5, 0.2, s);
  ok(Math.abs(c.x - 5) < 1e-9 && c.d2 < 0.05, 'closestOnSeg midpoint', JSON.stringify(c));
  const cl = C.closestOnSeg(-40, 0, s);
  ok(Math.abs(cl.t) < 1e-9, 'closestOnSeg clamps before start');
  const ch = C.closestOnSeg(40, 0, s);
  ok(Math.abs(ch.t - 1) < 1e-9, 'closestOnSeg clamps past end');
  ok(C.wrapAngle(Math.PI * 3) < Math.PI + 1e-9, 'wrapAngle bounds');
  ok(Math.abs(C.angDist(0.1, 0.4) - 0.3) < 1e-9, 'angDist');
}

section('surface / walls');
{
  const w1 = C.buildWorld(7);
  const p = C.makePlayer(w1);
  const surf = C.surfaceAt(w1, w1.spawn.x, w1.spawn.z, null);
  ok(surf.h <= 0.6, 'spawn ground reachable', surf.h);
  let inside = false;
  for (const b of w1.boxes) {
    if (b.kind !== 'building') continue;
    if (Math.abs(w1.spawn.x - b.x) < b.hw && Math.abs(w1.spawn.z - b.z) < b.hd) inside = true;
  }
  ok(!inside, 'spawn not inside a building');
  // walking into a building stops you
  const q = C.makePlayer(w1);
  const big = w1.boxes.filter(b => b.kind === 'building' && b.h > 15)[0];
  q.x = big.x - big.hw - 1.2; q.z = big.z; q.y = 0.1;
  q.vx = 14; q.vz = 0; q.heading = 0;
  const inp = C.makeInput(); inp.fwd = true;
  for (let i = 0; i < 60; i++) C.step(q, w1, 1 / 60, inp);
  ok(q.x < big.x - big.hw + 0.1, 'wall blocks penetration', q.x + ' vs ' + (big.x - big.hw));
  ok(Number.isFinite(q.x) && Number.isFinite(q.y) && Number.isFinite(q.z), 'player stays finite');
}
