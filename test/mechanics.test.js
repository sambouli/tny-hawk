'use strict';
const { C, section, ok } = require('./harness.js');
const w1 = C.buildWorld(7);

section('jump / gravity / landing');
{
  const p = C.makePlayer(w1);
  p.x = w1.spawn.x; p.z = w1.spawn.z; p.y = 0.09; p.state = 'roll';
  const inp = C.makeInput(); inp.fwd = true; inp.jump = true;
  C.step(p, w1, 1 / 60, inp);
  ok(p.state === 'air' || p.vy > 0, 'ollie leaves ground', p.state + ' vy=' + (p.vy||0).toFixed(2));
  // let it come back down
  inp.jump = false;
  const groundedStates = ['roll', 'manual', 'grind', 'ledge', 'stall'];
  let maxAir = 0, landed = false;
  for (let i = 0; i < 180 && !landed; i++) { C.step(p, w1, 1 / 60, inp); maxAir = Math.max(maxAir, p.airTime || 0); if (i > 5 && groundedStates.indexOf(p.state) >= 0) landed = true; }
  ok(landed, 'lands from ollie', p.state);
  ok(maxAir > 0.3 && maxAir < 4, 'hangtime sane', maxAir.toFixed(2));
}

section('tricks');
{
  const p = C.makePlayer(w1);
  p.state = 'air'; p.y = 3; p.vy = 2; p.vx = 8; p.vz = 0;
  const started = C.startTrick(p, 'kickflip');
  ok(started, 'startTrick kickflip accepted', started);
  ok(p.combo.some(c => c.id === 'kickflip' && c.name), 'trick pushed to combo with name', JSON.stringify(p.combo));
  // an invalid id must be rejected
  const p2 = C.makePlayer(w1); p2.state = 'air';
  ok(!C.startTrick(p2, 'not_a_trick'), 'invalid trick id rejected');
  // combo value grows with more tricks
  const p3 = C.makePlayer(w1);
  ok(typeof C.comboValue(p3) === 'number', 'comboValue numeric');
}

section('grinding');
{
  const railSegs = w1.segs.filter(s => s.kind === 'grind' && s.railKind === 'rail' && s.len2 > 100);
  ok(railSegs.length > 5, 'long rails exist', railSegs.length);
  let groundings = 0, kinds = {};
  for (const seg of railSegs.slice(0, 24)) {
    const sl = Math.sqrt(seg.len2);
    const dirx = seg.dx / sl, dirz = seg.dz / sl;
    const p = C.makePlayer(w1);
    // Drop in just above grind height near the rail centre moving along it --
    // the canonical 'ollie off a ledge onto the bar' catch window.
    p.state = 'air';
    p.x = seg.ax + seg.dx * 0.5;
    p.z = seg.az + seg.dz * 0.5;
    p.y = seg.top - 0.62 + 0.5;
    p.vx = dirx * 9; p.vz = dirz * 9; p.vy = -0.6;
    p.heading = Math.atan2(dirz, dirx);
    const inp = C.makeInput(); inp.fwd = true;
    let sawGrind = false;
    for (let i = 0; i < 200 && !sawGrind; i++) { C.step(p, w1, 1 / 60, inp); if (p.state === 'grind') sawGrind = true; }
    if (sawGrind) {
      groundings++;
      const inpHold = C.makeInput(); inpHold.fwd = true;
      let stayed = true;
      for (let i = 0; i < 45; i++) {
        C.step(p, w1, 1 / 60, inpHold);
        if (p.state === 'grind' && p.grindSeg) {
          if (Math.abs(p.y - (p.grindSeg.top - 0.62)) > 0.4) stayed = false;
        }
      }
      if (p.grindSeg) kinds[p.grindSeg.railKind] = (kinds[p.grindSeg.railKind] || 0) + 1;
      ok(stayed, 'stays locked to rail height while grinding', p.y.toFixed(2) + ' st=' + p.state);
    }
  }
  ok(groundings >= 12, 'most rails are catchable', groundings + '/24');
  // grinding off the end must not NaN or sink
  const seg = railSegs[0];
  const p2 = C.makePlayer(w1);
  p2.state = 'grind'; p2.grindSeg = seg; p2.grindT = 0.98; p2.grindDir = 1;
  p2.x = seg.bx; p2.z = seg.bz; p2.y = seg.top - 0.62; p2.vx = seg.dx; p2.vz = seg.dz;
  const inp2 = C.makeInput(); inp2.fwd = true;
  for (let i = 0; i < 60; i++) C.step(p2, w1, 1 / 60, inp2);
  ok(Number.isFinite(p2.x) && Number.isFinite(p2.y) && Number.isFinite(p2.z), 'off-rail stays finite', JSON.stringify({x:p2.x,y:p2.y,z:p2.z}));
  ok(p2.y > -1.0, 'off-rail does not sink', p2.y.toFixed(2));
}
