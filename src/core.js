(function (global) {
  'use strict';

  var DEG = Math.PI / 180;
  var GRAV = 34.0;          // units/s^2
  var JUMP_V = 12.6;        // launch speed
  var MAX_SPEED = 19.5;     // ground speed cap
  var ACCEL = 26.0;
  var TURN_RATE = 2.15;     // rad/s at full speed
  var PUMP_GAIN = 1.9;      // speed gained per carve second
  var AIR_ACCEL = 6.5;
  var OLLIE_TORSO = 14 * DEG;
  var GRIND_SNAP = 1.15;    // horizontal snap distance to a rail
  var GRIND_DROP = 0.62;    // board height under grind contact
  var GRIND_MAX_DROP = 2.6; // can only land on a rail from this far above it
  var LEDGE_LIFT = 0.5;     // extra clearance when riding a ledge top
  var STAT_TIME = 1.35;     // s of stillness before bailing off the board
  var HANGTIME = 1.28;

  var TRICKS = [
    { id: 'ollie', name: 'Ollie', keys: 'SPACE', pts: 10, spin: false },
    { id: 'kickflip', name: 'Kickflip', keys: 'Q', pts: 75, spin: false },
    { id: 'heelflip', name: 'Heelflip', keys: 'E', pts: 85, spin: false },
    { id: 'shove', name: 'Pop Shove-It', keys: 'Shift+Q', pts: 90, spin: false },
    { id: '360shove', name: '360 Shove-It', keys: 'Shift+E', pts: 160, spin: false },
    { id: 'fs50', name: 'FS 50', keys: 'A', pts: 40, spin: true },
    { id: 'bs180', name: 'BS 180', keys: 'D', pts: 80, spin: true },
    { id: 'fs180', name: 'FS 180', keys: 'F', pts: 110, spin: true },
    { id: 'fs360', name: 'FS 360', keys: 'G', pts: 220, spin: true },
    { id: 'handplant', name: 'Handplant', keys: 'H', pts: 130, spin: false }
  ];
  var TRICK_BY_ID = {};
  for (var ti = 0; ti < TRICKS.length; ti++) TRICK_BY_ID[TRICKS[ti].id] = TRICKS[ti];

  var GRIND_NAMES = {
    flat: 'Boardslide',
    front: 'Frontside Boardslide',
    back: 'Backside Boardslide',
    nose: 'Nose Slide',
    tail: 'Tail Slide',
    lipslide: 'Lipslide',
    blunt: 'Blunt Stall',
    rock: 'Rock to Fakie',
    handplant: 'Handplant'
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function wrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }
  function angDist(a, b) { return Math.abs(wrapAngle(a - b)); }
  function approach(cur, target, rate, dt) {
    var d = target - cur;
    if (Math.abs(d) <= rate * dt) return target;
    return cur + Math.sign(d) * rate * dt;
  }

  // ---------------------------------------------------------------- world
  // The city is Manhattan-ish: avenues run N-S (long), streets run E-W.
  // Everything static lives in segs (collision segments) and boxes.
  function makeWorld(seed) {
    var rnd = mulberry32(seed >>> 0);
    var w = {
      seed: seed >>> 0,
      blocks: [], lots: [], roads: [], props: [], boxes: [], segs: [],
      rails: [], ramps: [], ledges: [], parklets: [], doors: [], signs: [],
      blockHalf: 30, roadHalf: 11,
      avSpacing: 88, stSpacing: 96,
      avCount: 13, stCount: 11,
      skyline: null, parks: {}, plaza: null,
      spawn: { x: 0, z: 0 }
    };
    var bh = w.blockHalf, rh = w.roadHalf;
    var stepA = w.avSpacing, stepS = w.stSpacing;
    var iA, iS;

    // avenue index -> x centre ; street index -> z centre
    function avX(i) { return (i - (w.avCount - 1) / 2) * stepA; }
    function stZ(j) { return (j - (w.stCount - 1) / 2) * stepS; }
    w.avX = avX; w.stZ = stZ;

    // park corridors: avenue 3 is Central Park, plus Washington Sq plaza
    var parkAv = 3;
    var parkStLo = 1, parkStHi = 4;
    var plazaBlock = { i: 9, j: 8 };

    for (iA = 0; iA < w.avCount - 1; iA++) {
      for (iS = 0; iS < w.stCount - 1; iS++) {
        var cx = (avX(iA) + avX(iA + 1)) / 2;
        var cz = (stZ(iS) + stZ(iS + 1)) / 2;
        var inPark = (iA >= parkAv && iA < parkAv + 1) && (iS >= parkStLo && iS <= parkStHi);
        var isPlaza = (iA === plazaBlock.i && iS === plazaBlock.j);
        var lot = {
          kind: inPark ? 'park' : (isPlaza ? 'plaza' : 'lot'),
          cx: cx, cz: cz, hw: bh, hd: bh,
          i: iA, j: iS,
          buildings: [], trees: []
        };
        w.lots.push(lot);
      }
    }

    // road strips (for lane markings / geometry tint)
    for (iA = 0; iA < w.avCount; iA++) {
      w.roads.push({ axis: 'z', x: avX(iA), hw: rh, z0: stZ(0) - stepS / 2, z1: stZ(w.stCount - 1) + stepS / 2 });
    }
    for (iS = 0; iS < w.stCount; iS++) {
      w.roads.push({ axis: 'x', z: stZ(iS), hw: rh, x0: avX(0) - stepA / 2, x1: avX(w.avCount - 1) + stepA / 2 });
    }

    w.parks = { av: parkAv, stLo: parkStLo, stHi: parkStHi };
    w.plaza = plazaBlock;
    w.bounds = {
      x0: avX(0) - stepA / 2, x1: avX(w.avCount - 1) + stepA / 2,
      z0: stZ(0) - stepS / 2, z1: stZ(w.stCount - 1) + stepS / 2
    };
    w.skyline = {
      x0: w.bounds.x0 - 260, x1: w.bounds.x1 + 260,
      z0: w.bounds.z0 - 320, z1: w.bounds.z1 + 320
    };
    return w;
  }


  // ------------------------------------------------------------- geometry
  function addBox(w, o) {
    // o: {x,z,w,d,h,y?,kind,rot?,color?}  y = base height (default 0)
    var y = o.y || 0;
    var hw = o.w / 2, hd = o.d / 2;
    var b = {
      x: o.x, z: o.z, y: y, h: o.h, hw: hw, hd: hd,
      kind: o.kind || 'prop', rot: o.rot || 0,
      top: y + o.h
    };
    w.boxes.push(b);
    // Solid volumes need collision walls or the skater drives straight through
    // them. Emit four vertical edge segments at full height so resolveWalls
    // treats the footprint as impassable. Ledges manage their own edges.
    if (b.kind === 'building' || b.kind === 'landmark' || b.kind === 'bridge' || b.kind === 'fort' || b.kind === 'pedestal') {
      var rot = b.rot;
      var cs = rotatedCorners(b);
      addSeg(w, cs[0][0], cs[0][1], cs[1][0], cs[1][1], b.top, 'wall', { box: b });
      addSeg(w, cs[1][0], cs[1][1], cs[2][0], cs[2][1], b.top, 'wall', { box: b });
      addSeg(w, cs[2][0], cs[2][1], cs[3][0], cs[3][1], b.top, 'wall', { box: b });
      addSeg(w, cs[3][0], cs[3][1], cs[0][0], cs[0][1], b.top, 'wall', { box: b });
      void rot;
    }
    return b;
  }

  function rotatedCorners(b) {
    if (!b.rot) return cornersOf(b);
    var c = Math.cos(b.rot), s = Math.sin(b.rot);
    var pts = cornersOf(b), out = [];
    for (var i = 0; i < 4; i++) {
      var dx = pts[i][0] - b.x, dz = pts[i][1] - b.z;
      out.push([b.x + dx * c - dz * s, b.z + dx * s + dz * c]);
    }
    return out;
  }

  function addSeg(w, ax, az, bx, bz, top, kind, extra) {
    var s = {
      ax: ax, az: az, bx: bx, bz: bz, top: top,
      kind: kind, dx: bx - ax, dz: bz - az,
      len2: (bx - ax) * (bx - ax) + (bz - az) * (bz - az)
    };
    if (extra) for (var k in extra) s[k] = extra[k];
    w.segs.push(s);
    return s;
  }

  function addRail(w, pts, top, opts) {
    // pts: array of [x,z]; top: grind surface height
    opts = opts || {};
    var rail = { pts: pts.slice(), top: top, kind: opts.kind || 'rail', posts: !!opts.posts, id: w.rails.length };
    w.rails.push(rail);
    for (var i = 0; i < pts.length - 1; i++) {
      addSeg(w, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], top, 'grind',
        { rail: rail, railKind: opts.kind || 'rail' });
    }
    return rail;
  }

  function addRamp(w, o) {
    // quarterpipe / bank: runs along local X, slope rises toward +localZ
    // o: {x,z,w,h,dir(rad),kind}
    var r = {
      x: o.x, z: o.z, w: o.w, h: o.h, dir: o.dir || 0,
      kind: o.kind || 'bank',
      run: o.run || (o.h * 1.35)
    };
    w.ramps.push(r);
    return r;
  }

  function addLedge(w, o) {
    // grindable box: top is a ledge surface, sides are walls
    var b = addBox(w, { x: o.x, z: o.z, w: o.w, d: o.d, h: o.h, y: o.y || 0, kind: 'ledge' });
    var cs = cornersOf(b);
    var edges = [[0, 1], [1, 2], [2, 3], [3, 0]];
    for (var e = 0; e < 4; e++) {
      var a = cs[edges[e][0]], c = cs[edges[e][1]];
      addSeg(w, a[0], a[1], c[0], c[1], b.top, 'ledge', { box: b, ledge: true });
    }
    return b;
  }

  function cornersOf(b) {
    return [
      [b.x - b.hw, b.z - b.hd], [b.x + b.hw, b.z - b.hd],
      [b.x + b.hw, b.z + b.hd], [b.x - b.hw, b.z + b.hd]
    ];
  }

  // nearest point on segment, returns {t,x,z,d2}
  function closestOnSeg(px, pz, s) {
    var t = 0;
    if (s.len2 > 1e-9) t = clamp(((px - s.ax) * s.dx + (pz - s.az) * s.dz) / s.len2, 0, 1);
    var x = s.ax + s.dx * t, z = s.az + s.dz * t;
    var ddx = px - x, ddz = pz - z;
    return { t: t, x: x, z: z, d2: ddx * ddx + ddz * ddz };
  }

  // Uniform spatial hash over collision segments. surfaceAt/resolveWalls/findGrind
  // used to scan every segment each step (O(n)); with a dense city that dominated
  // the frame budget. Build once after the world is complete, then query only the
  // cells overlapping a small AABB around the probe point -- O(1) amortised.
  var GRID_CELL = 8;
  function buildGrid(w) {
    var cell = GRID_CELL, g = { cell: cell, map: {}, bounds: w.bounds };
    var segs = w.segs;
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      var minx = Math.min(s.ax, s.bx) - 2, maxx = Math.max(s.ax, s.bx) + 2;
      var minz = Math.min(s.az, s.bz) - 2, maxz = Math.max(s.az, s.bz) + 2;
      var cx0 = Math.floor(minx / cell), cx1 = Math.floor(maxx / cell);
      var cz0 = Math.floor(minz / cell), cz1 = Math.floor(maxz / cell);
      for (var cx = cx0; cx <= cx1; cx++) {
        for (var cz = cz0; cz <= cz1; cz++) {
          var key = cx + ',' + cz;
          (g.map[key] || (g.map[key] = [])).push(s);
        }
      }
    }
    w.grid = g;
    return g;
  }
  // collect unique segments whose cell overlaps the AABB [x-hx,x+hx]x[z-hz,z+hz]
  var _stamp = 0;
  function queryGrid(w, x, z, hx, hz) {
    var g = w.grid;
    if (!g) return w.segs;
    var out = [];
    _stamp++;
    var cell = g.cell;
    var cx0 = Math.floor((x - hx) / cell), cx1 = Math.floor((x + hx) / cell);
    var cz0 = Math.floor((z - hz) / cell), cz1 = Math.floor((z + hz) / cell);
    for (var cx = cx0; cx <= cx1; cx++) {
      for (var cz = cz0; cz <= cz1; cz++) {
        var arr = g.map[cx + ',' + cz];
        if (!arr) continue;
        for (var i = 0; i < arr.length; i++) {
          var s = arr[i];
          if (s.__st === _stamp) continue;
          s.__st = _stamp;
          out.push(s);
        }
      }
    }
    return out;
  }


  // ---------------------------------------------------------------- build
  var PAL = {
    asphalt: 0x2f3238, concrete: 0x9aa0a6, sidewalk: 0xb7bcc2, park: 0x4d6b3f,
    brick: 0x8c5a44, stone: 0xa89e8c, glass: 0x5d7488, modern: 0xc9ccd1,
    terra: 0xb2703f, yellow: 0xd8b23a, red: 0xb03a34, green: 0x3f7d4e,
    steel: 0x8d949c, water: 0x3d5a6b, dirt: 0x7d6a4e
  };

  function pick(rnd, arr) { return arr[(rnd() * arr.length) | 0]; }

  function facadeKind(rnd, iA, iS) {
    // downtown (south-east) is glassy/financial; midtown tall; uptown brownstone
    var r = rnd();
    if (iA >= 8 && iS >= 7) return r < 0.5 ? 'glass' : 'modern';
    if (iS <= 2) return r < 0.45 ? 'brick' : 'stone';
    if (r < 0.34) return 'brick';
    if (r < 0.62) return 'stone';
    if (r < 0.84) return 'glass';
    return 'modern';
  }

  function buildWorld(seed) {
    var w = makeWorld(seed);
    var rnd = mulberry32((seed ^ 0x9e3779b9) >>> 0);
    var bh = w.blockHalf, rh = w.roadHalf;

    for (var li = 0; li < w.lots.length; li++) {
      var lot = w.lots[li];
      if (lot.kind === 'park') { buildPark(w, lot, rnd); continue; }
      if (lot.kind === 'plaza') { buildPlaza(w, lot, rnd); continue; }
      buildLot(w, lot, rnd);
    }

    buildLandmarks(w, rnd);
    buildSpots(w, rnd);
    buildSkyline(w, rnd);
    buildStreetFurniture(w, rnd);

    buildGrid(w);   // spatial hash for physics queries (must exist before surfaceAt scans)
    // Spawn in a DENSE central block so the player starts surrounded by city,
    // not on a sparse edge lot. Scan street-grid intersections across the map,
    // score each open point by how many buildings/tall towers sit within ~70u,
    // and pick the busiest reachable spot nearest the centre.
    var bestSpawn = { x: w.spawn.x, z: w.spawn.z, score: -1 };
    var ccx = (w.bounds.x0 + w.bounds.x1) / 2, ccz = (w.bounds.z0 + w.bounds.z1) / 2;
    var halfSpan = Math.max(w.bounds.x1 - ccx, w.bounds.z1 - ccz);
    for (var gi = -3; gi <= 3; gi++) {
      for (var gj = -3; gj <= 3; gj++) {
        // candidate: an intersection offset toward a road lane (open asphalt)
        var sfx = w.avX(gi) + w.roadHalf + 5;
        var sfz = w.stZ(gj) + w.roadHalf + 5;
        if (sfx < w.bounds.x0 + 20 || sfx > w.bounds.x1 - 20 || sfz < w.bounds.z0 + 20 || sfz > w.bounds.z1 - 20) continue;
        var okSpot = true;
        for (var bi = 0; bi < w.boxes.length; bi++) {
          var bb = w.boxes[bi];
          if (bb.kind === 'building' || bb.kind === 'landmark') {
            if (Math.abs(sfx - bb.x) < bb.hw + 1.5 && Math.abs(sfz - bb.z) < bb.hd + 1.5) { okSpot = false; break; }
          }
        }
        if (!okSpot) continue;
        var surf = surfaceAt(w, sfx, sfz, null);
        if (surf.h > 0.7) continue;               // not flat ground
        // density score: nearby buildings, weighted tall, minus distance from centre
        var nb = 0, nt = 0;
        for (var bj = 0; bj < w.boxes.length; bj++) {
          var bc = w.boxes[bj];
          if (bc.kind !== 'building' && bc.kind !== 'landmark') continue;
          var ddx = bc.x - sfx, ddz = bc.z - sfz, d2 = ddx * ddx + ddz * ddz;
          if (d2 < 70 * 70) { nb++; if (bc.h > 18) nt++; }
        }
        var distC = Math.sqrt((sfx - ccx) * (sfx - ccx) + (sfz - ccz) * (sfz - ccz));
        var score = nb + nt * 2 - (distC / halfSpan) * 6;
        if (score > bestSpawn.score) { bestSpawn = { x: sfx, z: sfz, score: score }; }
      }
    }
    w.spawn.x = bestSpawn.x; w.spawn.z = bestSpawn.z;
    return w;
  }

  function buildLot(w, lot, rnd) {
    var inset = 3.2;                 // sidewalk width
    var x0 = lot.cx - lot.hw + inset, x1 = lot.cx + lot.hw - inset;
    var z0 = lot.cz - lot.hd + inset, z1 = lot.cz + lot.hd - inset;
    var kind = facadeKind(rnd, lot.i, lot.j);
    var tall = rnd() < 0.14;
    var layout = rnd();
    var footprints = [];

    if (layout < 0.42 || tall) {
      // one tower filling most of the lot
      var tw = (x1 - x0) * (0.72 + rnd() * 0.24);
      var td = (z1 - z0) * (0.72 + rnd() * 0.24);
      var h = tall ? (58 + rnd() * 96) : (20 + rnd() * 34);
      footprints.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, w: tw, d: td, h: h, kind: kind });
    } else if (layout < 0.76) {
      // perimeter block: two/three slabs around a courtyard
      var hh = 14 + rnd() * 26;
      footprints.push({ x: (x0 + x1) / 2, z: z0 + 5, w: x1 - x0, d: 10, h: hh, kind: kind });
      footprints.push({ x: x0 + 5, z: (z0 + z1) / 2, w: 10, d: z1 - z0, h: hh * (0.8 + rnd() * 0.3), kind: kind });
      if (rnd() < 0.6) footprints.push({ x: x1 - 5, z: (z0 + z1) / 2, w: 10, d: (z1 - z0) * 0.7, h: hh * 0.9, kind: kind });
      if (rnd() < 0.5) footprints.push({ x: (x0 + x1) / 2, z: z1 - 5, w: (x1 - x0) * 0.6, d: 10, h: hh * 0.7, kind: kind });
    } else {
      // row houses / tenements
      var n = 3 + ((rnd() * 2) | 0);
      var depth = z1 - z0;
      var span = (x1 - x0) / n;
      for (var i = 0; i < n; i++) {
        footprints.push({
          x: x0 + span * (i + 0.5), z: (z0 + z1) / 2,
          w: span * 0.9, d: depth * (0.72 + rnd() * 0.2),
          h: 9 + rnd() * 15, kind: rnd() < 0.6 ? 'brick' : 'stone'
        });
      }
    }

    for (var f = 0; f < footprints.length; f++) {
      var fp = footprints[f];
      var b = addBox(w, { x: fp.x, z: fp.z, w: fp.w, d: fp.d, h: fp.h, kind: 'building', facade: fp.kind });
      lot.buildings.push(b);
      addBuildingDress(w, b, fp.kind, rnd, lot);
    }
  }


  function addBuildingDress(w, b, facade, rnd, lot) {
    var cs = cornersOf(b);
    var bw = b.hw * 2, bd = b.hd * 2;   // full width/depth (boxes store half-extents)
    // stoop + doorway on the south face of low buildings (skateable ledges)
    if (b.h < 30 && rnd() < 0.72) {
      var sw = Math.min(bw * 0.42, 5.2);
      var sx = b.x + (rnd() - 0.5) * (bw - sw);
      var sz = b.z + b.hd + 0.9;
      var steps = 2 + ((rnd() * 3) | 0);
      for (var s = 0; s < steps; s++) {
        var sh = 0.18 * (steps - s);
        addBox(w, { x: sx, z: sz + 0.34 * s, w: sw - 0.6 * s, d: 0.7, h: sh, kind: 'step' });
      }
      addLedge(w, { x: sx, z: sz + 0.34 * steps + 0.5, w: sw + 1.4, d: 1.5, h: 0.18 * steps + 0.16 });
      w.doors.push({ x: sx, z: b.z + b.hd, h: b.h });
    }
    // storefront awning strip along one face
    if (b.h < 26 && rnd() < 0.6) {
      var aw = bw * (0.5 + rnd() * 0.4);
      addBox(w, {
        x: b.x + (rnd() - 0.5) * (bw - aw), z: b.z + b.hd + 0.7,
        w: aw, d: 1.5, h: 0.16, y: 2.7, kind: 'awning',
        color: pick(rnd, [PAL.red, PAL.green, PAL.yellow, 0x2f5d8a])
      });
    }
    // rooftop water tower / AC blocks on mid-rise
    if (b.h > 16 && rnd() < 0.62) {
      var nAc = 1 + ((rnd() * 3) | 0);
      for (var a = 0; a < nAc; a++) {
        addBox(w, {
          x: b.x + (rnd() - 0.5) * (bw - 3), z: b.z + (rnd() - 0.5) * (bd - 3),
          w: 1.1 + rnd(), d: 1.1 + rnd(), h: 0.7 + rnd() * 0.6, y: b.top, kind: 'ac', color: PAL.steel
        });
      }
      if (rnd() < 0.5) {
        var wt = 2.6 + rnd() * 1.4;
        var wx = b.x + (rnd() - 0.5) * (bw - 5), wz = b.z + (rnd() - 0.5) * (bd - 5);
        addBox(w, { x: wx, z: wz, w: 1.1, d: 1.1, h: 2.4, y: b.top, kind: 'leg', color: PAL.steel });
        addBox(w, { x: wx, z: wz, w: wt, d: wt, h: wt * 0.85, y: b.top + 2.4, kind: 'watertank', color: 0x6e5a46 });
      }
    }
    // cornice lip = grindable ledge around tall roofs
    if (b.h >= 30 && rnd() < 0.5) {
      addLedge(w, { x: b.x, z: b.z, w: bw + 0.5, d: bd + 0.5, h: 0.5, y: b.top - 0.02 });
    }
    // fire escape on a side wall (visual only, small ledges at height -> unreachable, skip)
    // dumpster in the alley notch
    if (rnd() < 0.34) {
      var dx = b.x + (rnd() < 0.5 ? -1 : 1) * (b.hw + 1.6);
      var dz = b.z + (rnd() - 0.5) * bd;
      addLedge(w, { x: dx, z: dz, w: 2.4, d: 1.3, h: 1.15 });
    }
    // sidewalk kerb is generated per-lot edge below
    void cs; void facade; void lot;
  }

  function buildPark(w, lot, rnd) {
    addBox(w, { x: lot.cx, z: lot.cz, w: lot.hw * 2, d: lot.hd * 2, h: 0.14, kind: 'grass', color: PAL.park });
    // pond
    var pr = Math.min(lot.hw, lot.hd) * 0.3;
    addBox(w, { x: lot.cx + lot.hw * 0.28, z: lot.cz - lot.hd * 0.2, w: pr * 2, d: pr * 1.4, h: 0.06, kind: 'water', color: PAL.water });
    // perimeter path ring (flat concrete)
    addBox(w, { x: lot.cx, z: lot.cz, w: lot.hw * 1.5, d: lot.hd * 1.5, h: 0.16, kind: 'path', color: PAL.concrete });
    // trees
    var nTrees = 26;
    for (var t = 0; t < nTrees; t++) {
      var tx = lot.cx + (rnd() - 0.5) * (lot.hw * 2 - 8);
      var tz = lot.cz + (rnd() - 0.5) * (lot.hd * 2 - 8);
      if (Math.abs(tx - (lot.cx + lot.hw * 0.28)) < pr + 2 && Math.abs(tz - (lot.cz - lot.hd * 0.2)) < pr + 2) continue;
      addTree(w, tx, tz, rnd, 1.6 + rnd() * 2.2);
    }
    // benches + low walls + a little bowl
    for (var bn = 0; bn < 7; bn++) {
      var bx = lot.cx + (rnd() - 0.5) * lot.hw * 1.3;
      var bz = lot.cz + (rnd() - 0.5) * lot.hd * 1.3;
      addLedge(w, { x: bx, z: bz, w: 2.1, d: 0.62, h: 0.46 });
    }
    for (var lw = 0; lw < 4; lw++) {
      var lx = lot.cx + (rnd() - 0.5) * lot.hw * 1.4;
      var lz = lot.cz + (rnd() - 0.5) * lot.hd * 1.4;
      var horiz = rnd() < 0.5;
      addLedge(w, { x: lx, z: lz, w: horiz ? 9 + rnd() * 7 : 0.7, d: horiz ? 0.7 : 9 + rnd() * 7, h: 0.62 });
    }
    addRamp(w, { x: lot.cx - lot.hw * 0.45, z: lot.cz + lot.hd * 0.5, w: 9, h: 2.4, dir: rnd() * Math.PI * 2, kind: 'bank' });
    addRail(w, [[lot.cx - 6, lot.cz + lot.hd * 0.5 - 5], [lot.cx + 6, lot.cz + lot.hd * 0.5 - 5]], 0.72, { posts: true });
  }

  function buildPlaza(w, lot, rnd) {
    addBox(w, { x: lot.cx, z: lot.cz, w: lot.hw * 2, d: lot.hd * 2, h: 0.16, kind: 'plaza', color: PAL.concrete });
    // the skate spot: stairs up to a raised platform with rails all round
    var px = lot.cx, pz = lot.cz;
    addLedge(w, { x: px, z: pz, w: 22, d: 16, h: 1.5 });
    addLedge(w, { x: px, z: pz + 10.5, w: 12, d: 5, h: 0.75 });
    // stair set down the front
    for (var s = 0; s < 5; s++) {
      addBox(w, { x: px, z: pz + 8 + s * 0.85, w: 11, d: 0.85, h: 1.5 - 0.3 * s, kind: 'step' });
    }
    addRail(w, [[px - 11, pz - 8], [px + 11, pz - 8]], 0.95, { posts: true });
    addRail(w, [[px - 11, pz - 8], [px - 11, pz + 8]], 0.95, { posts: true });
    addRail(w, [[px + 11, pz - 8], [px + 11, pz + 8]], 0.95, { posts: true });
    addRail(w, [[px - 6.2, pz + 8.2], [px - 6.2, pz + 13]], 0.85, { posts: true });
    addRail(w, [[px + 6.2, pz + 8.2], [px + 6.2, pz + 13]], 0.85, { posts: true });
    addRail(w, [[px - 4, pz + 13.4], [px + 4, pz + 13.4]], 0.55, {});
    // manual pad + flat bar + funbox
    addLedge(w, { x: px - 18, z: pz - 14, w: 7, d: 7, h: 0.34 });
    addRamp(w, { x: px + 17, z: pz - 13, w: 7.5, h: 2.1, dir: Math.PI, kind: 'quarter' });
    addRamp(w, { x: px + 17, z: pz - 6, w: 7.5, h: 2.1, dir: 0, kind: 'quarter' });
    addLedge(w, { x: px + 17, z: pz - 9.5, w: 7.5, d: 3.2, h: 2.1 });
    addRail(w, [[px - 20, pz + 4], [px - 12, pz + 4]], 0.66, { posts: true });
    addTree(w, px - 20, pz - 4, rnd, 3);
    addTree(w, px + 20, pz + 8, rnd, 3.4);
    w.plazaCenter = { x: px, z: pz };
  }


  function addTree(w, x, z, rnd, h) {
    addBox(w, { x: x, z: z, w: 0.42, d: 0.42, h: h * 0.55, kind: 'trunk', color: 0x5a4630 });
    addBox(w, { x: x, z: z, w: h * 0.9, d: h * 0.9, h: h * 0.8, y: h * 0.5, kind: 'leaf', color: pick(rnd, [0x4e7a3a, 0x5c8a42, 0x446b34]) });
    w.props.push({ kind: 'tree', x: x, z: z, h: h });
  }

  function buildLandmarks(w, rnd) {
    // ---- Empire State: midtown, on a lot near the middle avenues
    var esI = 5, esJ = 4;
    var ex = (w.avX(esI) + w.avX(esI + 1)) / 2;
    var ez = (w.stZ(esJ) + w.stZ(esJ + 1)) / 2;
    var tiers = [[26, 26, 30], [20, 20, 26], [14, 14, 22], [9, 9, 16]];
    var y = 0;
    for (var t = 0; t < tiers.length; t++) {
      addBox(w, { x: ex, z: ez, w: tiers[t][0], d: tiers[t][1], h: tiers[t][2], y: y, kind: 'landmark', facade: 'stone' });
      y += tiers[t][2];
    }
    addBox(w, { x: ex, z: ez, w: 3.2, d: 3.2, h: 16, y: y, kind: 'landmark', facade: 'stone' });
    addBox(w, { x: ex, z: ez, w: 0.7, d: 0.7, h: 14, y: y + 16, kind: 'mast', color: PAL.steel });
    w.landmarks = [{ name: 'Empire State Building', x: ex, z: ez, h: y + 30 }];

    // ---- Chrysler-ish: crown of stacked arcs
    var chI = 7, chJ = 3;
    var chx = (w.avX(chI) + w.avX(chI + 1)) / 2, chz = (w.stZ(chJ) + w.stZ(chJ + 1)) / 2;
    addBox(w, { x: chx, z: chz, w: 18, d: 18, h: 62, kind: 'landmark', facade: 'modern' });
    addBox(w, { x: chx, z: chz, w: 12, d: 12, h: 12, y: 62, kind: 'landmark', facade: 'glass' });
    addBox(w, { x: chx, z: chz, w: 7, d: 7, h: 10, y: 74, kind: 'landmark', facade: 'glass' });
    addBox(w, { x: chx, z: chz, w: 1.1, d: 1.1, h: 18, y: 84, kind: 'mast', color: 0xc9c2a8 });

    // ---- One WTC-ish glass shard uptown-west
    var wtI = 1, wtJ = 7;
    var wx = (w.avX(wtI) + w.avX(wtI + 1)) / 2, wz = (w.stZ(wtJ) + w.stZ(wtJ + 1)) / 2;
    addBox(w, { x: wx, z: wz, w: 17, d: 17, h: 88, rot: Math.PI / 4, kind: 'landmark', facade: 'glass' });
    addBox(w, { x: wx, z: wz, w: 0.6, d: 0.6, h: 16, y: 88, kind: 'mast', color: PAL.steel });

    // ---- Brooklyn Bridge over the east river strip
    var bx = w.bounds.x1 + 60;
    w.river = { x: bx - 26, w: 120 };
    addBox(w, { x: bx + 34, z: (w.bounds.z0 + w.bounds.z1) / 2, w: 120, d: w.bounds.z1 - w.bounds.z0 + 200, h: -0.5, y: 0, kind: 'water', color: PAL.water });
    var bridgeZ = w.stZ(5);
    // deck
    addLedge(w, { x: bx + 34, z: bridgeZ, w: 150, d: 11, h: 5.2 });
    // stone towers with pointed arches
    for (var p = 0; p < 2; p++) {
      var txp = bx + 6 + p * 56;
      addBox(w, { x: txp, z: bridgeZ - 4.4, w: 7, d: 5, h: 34, kind: 'bridge', facade: 'stone' });
      addBox(w, { x: txp, z: bridgeZ + 4.4, w: 7, d: 5, h: 34, kind: 'bridge', facade: 'stone' });
      addBox(w, { x: txp, z: bridgeZ, w: 7, d: 3.2, h: 6, y: 14, kind: 'bridge', facade: 'stone' });
      addBox(w, { x: txp, z: bridgeZ, w: 7, d: 11, h: 2.2, y: 34, kind: 'bridge', facade: 'stone' });
    }
    // suspension cables (grindable!) along the deck edges
    addRail(w, [[bx - 38, bridgeZ - 4.2], [bx + 106, bridgeZ - 4.2]], 6.1, {});
    addRail(w, [[bx - 38, bridgeZ + 4.2], [bx + 106, bridgeZ + 4.2]], 6.1, {});
    // hangers
    for (var hg = 0; hg < 26; hg++) {
      var hx = bx - 34 + hg * 5.4;
      addBox(w, { x: hx, z: bridgeZ - 4.2, w: 0.16, d: 0.16, h: 5.2, y: 5.2, kind: 'cable', color: 0xb9c0c6 });
      addBox(w, { x: hx, z: bridgeZ + 4.2, w: 0.16, d: 0.16, h: 5.2, y: 5.2, kind: 'cable', color: 0xb9c0c6 });
    }
    // approach ramps so the player can actually get up there
    addRamp(w, { x: bx - 46, z: bridgeZ, w: 11, h: 5.2, dir: Math.PI / 2, run: 14, kind: 'bank' });
    w.landmarks.push({ name: 'Brooklyn Bridge', x: bx + 34, z: bridgeZ, h: 36 });

    // Statue of Liberty far in the river
    addBox(w, { x: bx + 40, z: w.bounds.z0 + 30, w: 14, d: 14, h: 6, kind: 'fort', facade: 'stone' });
    addBox(w, { x: bx + 40, z: w.bounds.z0 + 30, w: 5, d: 5, h: 12, y: 6, kind: 'pedestal', facade: 'stone' });
    addBox(w, { x: bx + 40, z: w.bounds.z0 + 30, w: 2.6, d: 2.2, h: 9, y: 18, kind: 'statue', color: 0x5f9a86 });
    addBox(w, { x: bx + 41.6, z: w.bounds.z0 + 30, w: 0.7, d: 0.7, h: 6, y: 21, kind: 'statue', color: 0x5f9a86 });
  }


  function buildSpots(w, rnd) {
    // Named spots sprinkled on the street grid: ledges, stairs, rails, banks.
    var spots = [];
    var n = 16;
    for (var s = 0; s < n; s++) {
      var lot = w.lots[(rnd() * w.lots.length) | 0];
      if (lot.kind !== 'lot') continue;
      var edge = (rnd() * 4) | 0;
      var sx = lot.cx + (rnd() - 0.5) * lot.hw;
      var sz = lot.cz + (rnd() - 0.5) * lot.hd;
      // push to the sidewalk ring
      if (edge === 0) sz = lot.cz - lot.hd - 2.2;
      else if (edge === 1) sz = lot.cz + lot.hd + 2.2;
      else if (edge === 2) sx = lot.cx - lot.hw - 2.2;
      else sx = lot.cx + lot.hw + 2.2;
      var style = (rnd() * 4) | 0;
      if (style === 0) {
        // stair set + handrail
        var st = 4 + ((rnd() * 4) | 0);
        var dir = (edge < 2) ? (edge === 0 ? Math.PI : 0) : (edge === 2 ? -Math.PI / 2 : Math.PI / 2);
        var dx = Math.sin(dir), dz = Math.cos(dir);
        for (var i = 0; i < st; i++) {
          addBox(w, { x: sx + dx * i * 0.8, z: sz + dz * i * 0.8, w: 8, d: 0.8, h: 0.3 * (st - i), kind: 'step' });
        }
        addRail(w, [[sx + dx * st * 0.8 - dz * 3.6, sz + dz * st * 0.8 + dx * 3.6],
                    [sx - dz * 3.6, sz + dx * 3.6]], 1.05, { posts: true });
        addLedge(w, { x: sx - dz * 4.4, z: sz + dx * 4.4, w: 9, d: 0.7, h: 0.6 });
      } else if (style === 1) {
        // flat bar + manual pad
        var L = 7 + rnd() * 6;
        var a = rnd() * Math.PI * 2;
        var ca = Math.cos(a), sa = Math.sin(a);
        addRail(w, [[sx - ca * L / 2, sz - sa * L / 2], [sx + ca * L / 2, sz + sa * L / 2]], 0.72, { posts: true });
        addLedge(w, { x: sx + sa * 3.5, z: sz - ca * 3.5, w: 5.5, d: 5.5, h: 0.3 });
      } else if (style === 2) {
        // ledge bank + rail
        var lw = 8 + rnd() * 8;
        addLedge(w, { x: sx, z: sz, w: lw, d: 1.0, h: 0.85 });
        addRail(w, [[sx - lw / 2, sz - 2.4], [sx + lw / 2, sz - 2.4]], 0.9, { posts: true });
        addRamp(w, { x: sx + lw / 2 + 3, z: sz, w: 6, h: 1.6, dir: -Math.PI / 2, kind: 'bank' });
      } else {
        // mini funbox / grind box cluster
        addLedge(w, { x: sx, z: sz, w: 5.5, d: 3.6, h: 1.05 });
        addLedge(w, { x: sx + 6, z: sz, w: 3.4, d: 3.4, h: 0.55 });
        addRail(w, [[sx - 2.8, sz + 2.6], [sx + 2.8, sz + 2.6]], 0.62, {});
      }
      spots.push({ name: spotName(rnd), x: sx, z: sz });
    }
    w.spots = spots;
  }

  var SPOT_ADJ = ['Filthy', 'Gnarly', 'Dirty', 'Holy', 'Sick', 'Buzzy', 'Legendary', 'Cursed'];
  var SPOT_NOUN = ['Stairs', 'Manual Pad', 'Handrail', 'Planter', 'Kerb', 'Bank', 'Ledge', 'Flat Bar', 'Funbox', 'Spine'];
  var SPOT_PLACE = ['of Avenues', 'on Bleecker', 'at Delancey', 'in Chinatown', 'of Alphabet City', 'on Ludlow',
    'near Houston', 'off Canal', 'in the Village', 'on Rivington', 'at Bowery', 'of Harlem'];
  function spotName(rnd) {
    return pick(rnd, SPOT_ADJ) + ' ' + pick(rnd, SPOT_NOUN) + ' ' + pick(rnd, SPOT_PLACE);
  }

  function buildSkyline(w, rnd) {
    // dense filler towers outside the playable grid, so the city reads huge
    var sk = w.skyline, list = [];
    var step = 46;
    for (var x = sk.x0; x < sk.x1; x += step) {
      for (var z = sk.z0; z < sk.z1; z += step) {
        if (x > w.bounds.x0 - 40 && x < w.bounds.x1 + 40 && z > w.bounds.z0 - 40 && z < w.bounds.z1 + 40) continue;
        if (w.river && x > w.river.x - 20) continue;
        if (rnd() < 0.22) continue;
        var hgt = 12 + Math.pow(rnd(), 2.1) * 130;
        var dist = Math.max(Math.abs(x - (sk.x0 + sk.x1) / 2), Math.abs(z - (sk.z0 + sk.z1) / 2)) / 500;
        hgt *= clamp(1.25 - dist * 0.5, 0.35, 1.25);
        list.push({
          x: x + (rnd() - 0.5) * 14, z: z + (rnd() - 0.5) * 14,
          w: 16 + rnd() * 22, d: 16 + rnd() * 22, h: hgt,
          facade: pick(rnd, ['brick', 'stone', 'glass', 'modern'])
        });
      }
    }
    w.filler = list;
  }

  function buildStreetFurniture(w, rnd) {
    var rh = w.roadHalf;
    // kerbs around every block + hydrants, bins, benches, bus stops, lights
    for (var li = 0; li < w.lots.length; li++) {
      var lot = w.lots[li];
      var x0 = lot.cx - lot.hw, x1 = lot.cx + lot.hw, z0 = lot.cz - lot.hd, z1 = lot.cz + lot.hd;
      addLedge(w, { x: lot.cx, z: z0, w: lot.hw * 2, d: 0.34, h: 0.15 });
      addLedge(w, { x: lot.cx, z: z1, w: lot.hw * 2, d: 0.34, h: 0.15 });
      addLedge(w, { x: x0, z: lot.cz, w: 0.34, d: lot.hd * 2, h: 0.15 });
      addLedge(w, { x: x1, z: lot.cz, w: 0.34, d: lot.hd * 2, h: 0.15 });

      if (lot.kind !== 'lot') continue;
      // hydrant + bin + bench on the sidewalk
      var hx = x0 + 2 + rnd() * (lot.hw * 2 - 4);
      addBox(w, { x: hx, z: z0 - 1.5, w: 0.42, d: 0.42, h: 0.86, kind: 'hydrant', color: 0xb23a2e });
      var bx2 = x0 + 2 + rnd() * (lot.hw * 2 - 4);
      addBox(w, { x: bx2, z: z1 + 1.6, w: 0.8, d: 0.55, h: 0.95, kind: 'bin', color: 0x3f4a44 });
      if (rnd() < 0.7) addLedge(w, { x: x1 + 1.7, z: lot.cz + (rnd() - 0.5) * lot.hd, w: 0.62, d: 2.2, h: 0.46 });
    }

    // traffic lights at intersections + street lamps along avenues
    for (var i = 0; i < w.avCount; i++) {
      for (var j = 0; j < w.stCount; j++) {
        var ix = w.avX(i), iz = w.stZ(j);
        addPole(w, ix - rh + 0.9, iz - rh + 0.9, 7.4, 'light', rnd);
        if (rnd() < 0.5) addPole(w, ix + rh - 0.9, iz + rh - 0.9, 7.4, 'light', rnd);
      }
    }
    for (var ii = 0; ii < w.avCount; ii++) {
      for (var jj = 0; jj < w.stCount - 1; jj++) {
        var mx = w.avX(ii) - w.roadHalf + 0.8;
        var mz = (w.stZ(jj) + w.stZ(jj + 1)) / 2;
        addPole(w, mx, mz, 5.6, 'lamp', rnd);
      }
    }
    // yellow cabs parked along the curbs
    w.cabs = [];
    for (var c = 0; c < 46; c++) {
      var horiz = rnd() < 0.5;
      var av = (rnd() * w.avCount) | 0, st = (rnd() * (w.stCount - 1)) | 0;
      var cx, cz, rot;
      if (horiz) {
        cz = w.stZ(st) + (rnd() < 0.5 ? -1 : 1) * (w.roadHalf - 1.9);
        cx = lerp(w.stZ(0), w.stZ(w.stCount - 1), 0) ; void av;
        cx = w.avX(0) - 40 + rnd() * (w.avX(w.avCount - 1) - w.avX(0) + 80);
        rot = rnd() < 0.5 ? 0 : Math.PI;
      } else {
        cx = w.avX(av) + (rnd() < 0.5 ? -1 : 1) * (w.roadHalf - 1.9);
        cz = w.stZ(st) + 8 + rnd() * (w.stSpacing - 16);
        rot = rnd() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
      }
      w.cabs.push({ x: cx, z: cz, rot: rot, seed: (rnd() * 1e9) | 0 });
      addBox(w, { x: cx, z: cz, w: 2.1, d: 4.9, h: 1.5, y: 0.28, kind: 'cabbody', color: 0xe8b421 });
      addBox(w, { x: cx, z: cz - 0.2, w: 1.8, d: 2.4, h: 0.85, y: 1.78, kind: 'cabtop', color: 0xd9a91c });
    }
  }

  function addPole(w, x, z, h, kind, rnd) {
    addBox(w, { x: x, z: z, w: 0.26, d: 0.26, h: h, kind: 'pole', color: 0x4a4f55 });
    if (kind === 'light') {
      var arm = 1.9;
      addBox(w, { x: x + arm / 2, z: z, w: arm, d: 0.2, h: 0.18, y: h - 0.3, kind: 'arm', color: 0x4a4f55 });
      addBox(w, { x: x + arm, z: z, w: 0.42, d: 0.42, h: 1.1, y: h - 1.35, kind: 'signal', color: 0x2b2f33 });
      w.signs.push({ x: x + arm, z: z, y: h - 1.35, kind: 'signal' });
    } else {
      addBox(w, { x: x, z: z, w: 0.7, d: 0.7, h: 0.3, y: h, kind: 'lamphead', color: 0xf0e2a8 });
      w.signs.push({ x: x, z: z, y: h, kind: 'lamp' });
    }
    void rnd;
  }


  // ---------------------------------------------------------------- physics
  function makePlayer(w) {
    return {
      x: w.spawn.x, y: 0.09, z: w.spawn.z,
      heading: Math.PI * 0.25,          // travel direction (rad, XZ)
      vx: 0, vz: 0, vy: 0,
      state: 'roll',                    // roll|manual|air|grind|ledge|stall|handplant|bail|statue
      onBoard: true,
      speed: 0,
      crouch: 0,                        // visual crouch 0..1
      boardSpin: 0, boardSpinVel: 0,    // kickflip/heel/shove (board-local roll)
      shoveRot: 0,                      // pop shove visual yaw of board
      bodyYaw: 0,                       // trick-induced body twist
      grindKind: null, grindSeg: null, grindT: 0, grindDir: 1, grindSpeed: 0,
      airTime: 0, airDist: 0, lastX: 0, lastZ: 0,
      combo: [], comboPts: 0, comboTimer: 0,
      manualTimer: 0, manualPts: 0,
      tricksDone: {},                   // id -> count (for "new trick" bonus)
      score: 0, bestTrick: '', bails: 0, lands: 0,
      statTimer: 0, bailTimer: 0,
      grinding: false,
      handSide: 1,
      pushPhase: 0,
      charge: 0                         // reserved for future boost
    };
  }

  function grounded(p) {
    return p.state === 'roll' || p.state === 'manual' || p.state === 'grind' ||
      p.state === 'ledge' || p.state === 'stall' || p.state === 'handplant';
  }

  // height of the surface under (x,z). Returns {h, seg} using cached candidate.
  function surfaceAt(w, x, z, prevSeg) {
    var best = 0, bestSeg = null;
    if (prevSeg) {
      var cp = closestOnSeg(x, z, prevSeg);
      if (cp.d2 < 1.44 && cp.top_ok !== false) {
        if (prevSeg.top > best) { best = prevSeg.top; bestSeg = prevSeg; }
      }
    }
    var segs = queryGrid(w, x, z, 2.5, 2.5);
    var r2 = 1.44;
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (s === prevSeg) continue;
      // cheap reject: bbox expanded
      var minx = s.ax < s.bx ? s.ax : s.bx, maxx = s.ax < s.bx ? s.bx : s.ax;
      var minz = s.az < s.bz ? s.az : s.bz, maxz = s.az < s.bz ? s.bz : s.az;
      if (x < minx - 1.3 || x > maxx + 1.3 || z < minz - 1.3 || z > maxz + 1.3) continue;
      var cp2 = closestOnSeg(x, z, s);
      if (cp2.d2 > r2) continue;
      if (s.top > best) { best = s.top; bestSeg = s; }
    }
    // ramps
    for (var r = 0; r < w.ramps.length; r++) {
      var rp = w.ramps[r];
      var lx = x - rp.x, lz = z - rp.z;
      var ca = Math.cos(-rp.dir), sa = Math.sin(-rp.dir);
      var rx = lx * ca - lz * sa, rz = lx * sa + lz * ca;
      if (Math.abs(rx) > rp.w / 2 || rz < 0 || rz > rp.run) continue;
      var t = rz / rp.run;
      var hh;
      if (rp.kind === 'quarter') hh = rp.h * Math.sin(t * Math.PI / 2);
      else hh = rp.h * t * t * (3 - 2 * t) * 0.92 + rp.h * t * 0.08;
      if (hh > best) { best = hh; bestSeg = null; }
    }
    return { h: best, seg: bestSeg };
  }

  // horizontal collision against tall segments (walls above the feet)
  function resolveWalls(w, p, feetY) {
    var hitWall = false;
    var segs = queryGrid(w, p.x, p.z, 3, 3);
    var rad = 0.42;
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (s.top <= feetY + 0.34) continue;           // rideable, not a wall
      var minx = s.ax < s.bx ? s.ax : s.bx, maxx = s.ax < s.bx ? s.bx : s.ax;
      var minz = s.az < s.bz ? s.az : s.bz, maxz = s.az < s.bz ? s.bz : s.az;
      if (p.x < minx - 2 || p.x > maxx + 2 || p.z < minz - 2 || p.z > maxz + 2) continue;
      var cp = closestOnSeg(p.x, p.z, s);
      var d = Math.sqrt(cp.d2);
      if (d < rad) {
        var nx, nz;
        if (d < 1e-5) { nx = 0; nz = 1; } else { nx = (p.x - cp.x) / d; nz = (p.z - cp.z) / d; }
        p.x = cp.x + nx * rad; p.z = cp.z + nz * rad;
        var vn = p.vx * nx + p.vz * nz;
        if (vn < 0) {
          p.vx -= vn * nx * 1.35; p.vz -= vn * nz * 1.35;
          if (-vn > 9) hitWall = true;
        }
      }
    }
    return hitWall;
  }


  // ------------------------------------------------------------- grind find
  function findGrind(w, p, feetY) {
    var best = null, bestD2 = GRIND_SNAP * GRIND_SNAP;
    var segs = queryGrid(w, p.x, p.z, GRIND_SNAP + 2, GRIND_SNAP + 2);
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (s.kind !== 'grind' && !s.ledge) continue;
      if (Math.abs(s.top - (feetY + GRIND_DROP)) > 0.55) continue;
      var minx = s.ax < s.bx ? s.ax : s.bx, maxx = s.ax < s.bx ? s.bx : s.ax;
      var minz = s.az < s.bz ? s.az : s.bz, maxz = s.az < s.bz ? s.bz : s.az;
      if (p.x < minx - 2 || p.x > maxx + 2 || p.z < minz - 2 || p.z > maxz + 2) continue;
      var cp = closestOnSeg(p.x, p.z, s);
      if (cp.d2 > bestD2) continue;
      // direction alignment with the segment
      var sl = Math.sqrt(s.len2) || 1;
      var sdx = s.dx / sl, sdz = s.dz / sl;
      var hdx = Math.cos(p.heading), hdz = Math.sin(p.heading);
      var dot = Math.abs(sdx * hdx + sdz * hdz);
      if (dot < 0.42) continue;
      bestD2 = cp.d2;
      best = { seg: s, t: cp.t, x: cp.x, z: cp.z, dir: (sdx * hdx + sdz * hdz) >= 0 ? 1 : -1, align: dot };
    }
    return best;
  }

  function grindKindFor(p, seg) {
    if (seg.railKind === 'rail') {
      // frontside/backside by which side of travel the rail sits
      var s = seg, sl = Math.sqrt(s.len2) || 1;
      var nx = -(s.dz / sl), nz = (s.dx / sl);
      var hdx = Math.cos(p.heading), hdz = Math.sin(p.heading);
      var side = nx * hdz - nz * hdx;
      return side > 0 ? 'front' : 'back';
    }
    if (seg.ledge) {
      var f = 0.62;
      var hx = Math.cos(p.heading), hz = Math.sin(p.heading);
      // approach angle relative to ledge normal decides nose/tail/lipslide naming
      return Math.abs(hx) > f || Math.abs(hz) > f ? 'flat' : 'lipslide';
    }
    return 'flat';
  }

  // ------------------------------------------------------------------ step
  function startTrick(p, id) {
    if (p.state !== 'air') return false;
    if (p.combo.some(function (c) { return c.id === id; })) return false;
    var tr = TRICK_BY_ID[id];
    if (!tr) return false;
    p.combo.push({ id: id, name: tr.name, pts: tr.pts, t: 0 });
    if (id === 'kickflip') p.boardSpinVel = 13.5;
    else if (id === 'heelflip') p.boardSpinVel = -13.0;
    else if (id === 'shove') p.boardSpinVel = 7.0;
    else if (id === '360shove') p.boardSpinVel = 11.0;
    else if (id === 'handplant') {
      p.state = 'handplant'; p.vy = 0; p.handSide = 1;
    } else if (tr.spin) {
      p.bodyYaw += (id === 'fs50' ? 90 : id === 'bs180' ? 180 : id === 'fs180' ? 180 : 360) * DEG;
    }
    p.crouch = 0;
    return true;
  }

  function comboValue(p) {
    var v = 0, mult = 1;
    for (var i = 0; i < p.combo.length; i++) {
      var c = p.combo[i];
      var m = c.mult || 1;
      v += c.pts * m;
      mult *= 1.0;
    }
    v += p.manualPts;
    var chain = p.combo.length;
    if (chain > 1) v *= (1 + (chain - 1) * 0.25);
    return Math.round(v);
  }

  function bankCombo(p, reason) {
    if (p.combo.length === 0 && p.manualPts <= 0) return;
    var v = comboValue(p);
    if (v > 0) {
      p.score += v;
      var names = p.combo.map(function (c) { return c.name; });
      if (p.manualPts > 0) names.push('Manual ' + Math.round(p.manualPts));
      var label = names.join(' + ');
      if (label.length > p.bestTrick.length || v > p.bestTrickPts) { p.bestTrick = label; p.bestTrickPts = v; }
      p.lastBank = { pts: v, label: label, reason: reason || '' };
      p.lands++;
    }
    p.combo = []; p.comboTimer = 0; p.manualPts = 0; p.manualTimer = 0;
  }

  function bail(p, why) {
    if (p.state === 'bail') return;
    bankCombo(p, '');
    p.state = 'bail';
    p.onBoard = false;
    p.bailTimer = 1.15;
    p.bails++;
    p.bailWhy = why || '';
    p.vx *= 0.35; p.vz *= 0.35;
    p.vy = 3.2;
  }


  function step(p, w, dt, inp) {
    if (dt <= 0) return p;
    if (dt > 0.05) dt = 0.05;
    // 'statue' is a cosmetic idle: it behaves like a roll but scores nothing
    var wasStatue = (p.state === 'statue');
    if (wasStatue) p.state = 'roll';
    var fx = Math.cos(p.heading), fz = Math.sin(p.heading);
    var rx = -fz, rz = fx;                     // right vector
    var fwdInp = (inp.fwd ? 1 : 0) - (inp.back ? 1 : 0);
    var turnInp = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);

    if (p.state === 'bail') {
      p.bailTimer -= dt;
      p.vy -= GRAV * dt;
      p.y += p.vy * dt;
      p.x += p.vx * dt; p.z += p.vz * dt;
      p.vx *= (1 - 2.4 * dt); p.vz *= (1 - 2.4 * dt);
      var g0 = surfaceAt(w, p.x, p.z, null);
      if (p.y < g0.h + 0.05) { p.y = g0.h + 0.05; p.vy = 0; }
      if (p.bailTimer <= 0) {
        p.state = 'roll'; p.onBoard = true;
        p.vx = fx * 3.2; p.vz = fz * 3.2; p.boardSpin = 0; p.boardSpinVel = 0; p.shoveRot = 0; p.bodyYaw = 0;
      }
      resolveWalls(w, p, p.y);
      return p;
    }

    // ---------------------------------------------------------- grinding
    if (p.state === 'grind') {
      var s = p.grindSeg;
      var sl = Math.sqrt(s.len2) || 1;
      var sdx = s.dx / sl * p.grindDir, sdz = s.dz / sl * p.grindDir;
      // carving on the rail changes speed; leaning off the end bails
      p.grindSpeed += (inp.fwd ? PUMP_GAIN * 0.7 : 0) * dt;
      p.grindSpeed -= (inp.back ? 5.0 : 0) * dt;
      p.grindSpeed -= 0.55 * dt;
      p.grindSpeed = clamp(p.grindSpeed, 1.2, MAX_SPEED);
      p.grindT += (p.grindSpeed * dt) / sl;
      // steering nudges across the rail
      p.x += rx * turnInp * 1.6 * dt; p.z += rz * turnInp * 1.6 * dt;
      var px = s.ax + s.dx * p.grindT, pz = s.az + s.dz * p.grindT;
      p.x = lerp(p.x, px, 1 - Math.pow(0.0001, dt));
      p.z = lerp(p.z, pz, 1 - Math.pow(0.0001, dt));
      p.y = s.top - GRIND_DROP;
      p.heading = Math.atan2(sdz, sdx);
      p.vx = sdx * p.grindSpeed; p.vz = sdz * p.grindSpeed;
      p.airTime += dt;
      p.comboTimer = 0.9;
      if (p.grindT < -0.01 || p.grindT > 1.01) {
        // run off the end: keep going, become airborne if there is a drop
        var gf = surfaceAt(w, p.x, p.z, null);
        p.state = 'air';
        p.vy = 1.6;
        p.grindSeg = null; p.grinding = false;
        if (gf.h > p.y - 0.2) { p.state = 'roll'; p.y = gf.h + 0.09; }
      }
      if (inp.jump) {
        var jf = surfaceAt(w, p.x, p.z, null);
        p.state = 'air'; p.vy = JUMP_V * 0.86; p.y += 0.05;
        p.grindSeg = null; p.grinding = false;
        p.crouch = 0;
        void jf;
      }
      resolveWalls(w, p, p.y + GRIND_DROP);
      return p;
    }

    // --------------------------------------------------------- handplant
    if (p.state === 'handplant') {
      p.airTime += dt;
      p.comboTimer = 0.9;
      p.vy -= GRAV * 0.25 * dt;
      p.y += p.vy * dt * 0.2;
      if (inp.left) p.handSide = -1; if (inp.right) p.handSide = 1;
      p.heading += turnInp * 1.4 * dt;
      if (!inp.holdTrick || inp.jump) {
        p.state = 'air'; p.vy = 2.2;
      }
      return p;
    }

    // ------------------------------------------------------------ airborne
    if (p.state === 'air') {
      p.airTime += dt;
      p.vy -= GRAV * dt;
      p.y += p.vy * dt;
      p.x += p.vx * dt; p.z += p.vz * dt;
      p.lastX += p.vx * dt; p.lastZ += p.vz * dt;
      p.heading += turnInp * TURN_RATE * 0.62 * dt;
      // air steer a touch
      p.vx += (Math.cos(p.heading) * AIR_ACCEL * fwdInp) * dt;
      p.vz += (Math.sin(p.heading) * AIR_ACCEL * fwdInp) * dt;
      // board spin decay (flip completes)
      p.boardSpin += p.boardSpinVel * dt;
      if (Math.abs(p.boardSpinVel) > 0) {
        if (Math.abs(p.boardSpin) >= Math.PI * 2) { p.boardSpin = 0; p.boardSpinVel = 0; }
      }
      p.shoveRot += (p.boardSpinVel ? p.boardSpinVel * 0.35 : 0) * dt;
      p.bodyYaw = approach(p.bodyYaw, 0, 3.4 * Math.PI, dt);
      for (var ci = 0; ci < p.combo.length; ci++) p.combo[ci].t += dt;

      var feetY = p.y;
      // grind catch while descending
      if (p.vy < 0) {
        var gc = findGrind(w, p, feetY);
        if (gc && feetY - (gc.seg.top - GRIND_DROP) < GRIND_MAX_DROP) {
          bankComboKeep(p);
          p.state = 'grind'; p.grindSeg = gc.seg; p.grindT = gc.t; p.grindDir = gc.dir;
          p.grindSpeed = Math.max(4.2, Math.hypot(p.vx, p.vz) * 0.86);
          p.grinding = true;
          p.y = gc.seg.top - GRIND_DROP;
          var kind = grindKindFor(p, gc.seg);
          addAutoTrick(p, GRIND_NAMES[kind], gc.seg.railKind === 'rail' ? 120 : 95);
          return p;
        }
      }
      var surf = surfaceAt(w, p.x, p.z, p.groundHint);
      if (feetY <= surf.h + 0.06 && p.vy <= 0) {
        // landing check: board must be flat-ish and landings within tolerance
        var flat = Math.abs(wrapAngle(p.boardSpin)) < 0.55 || Math.abs(p.boardSpin) > Math.PI * 1.45;
        var slopeOk = true;
        if (!flat) { bail(p, 'under-rotated'); return p; }
        p.y = surf.h + 0.09;
        p.groundHint = surf.seg;
        var sp = Math.hypot(p.vx, p.vz);
        // transition to ledge ride if we landed on a ledge top
        if (surf.seg && surf.seg.ledge) {
          p.state = 'ledge';
          addAutoTrick(p, 'Ledge Ride', 70);
        } else {
          p.state = 'roll';
        }
        p.vy = 0;
        p.boardSpin = 0; p.boardSpinVel = 0; p.shoveRot = 0;
        p.crouch = clamp(sp / MAX_SPEED, 0, 1) * 0.55;
        // preserve most speed, punish hard landings
        var loss = clamp(1 - (p.airTime > HANGTIME * 1.6 ? 0.18 : 0.04), 0.6, 1);
        p.vx *= loss; p.vz *= loss;
        p.speed = sp * loss;
        bankCombo(p, 'landed');
        void slopeOk;
      }
      resolveWalls(w, p, p.y);
      return p;
    }

    // ------------------------------------------------------- ground states
    var surfG = surfaceAt(w, p.x, p.z, p.groundHint);
    if (p.state === 'ledge') {
      // riding a ledge: fast, can ollie off or stall on the edge
      p.comboTimer = 0.9;
      if (p.y > surfG.h + LEDGE_LIFT + 0.25) { p.state = 'air'; p.vy = 0; return p; }
    }
    p.y = approach(p.y, surfG.h + 0.09, 12, dt);
    if (Math.abs(p.y - (surfG.h + 0.09)) < 0.02) p.y = surfG.h + 0.09;

    // speed & carve
    var sp2 = Math.hypot(p.vx, p.vz);
    if (fwdInp > 0) {
      p.vx += fx * ACCEL * dt; p.vz += fz * ACCEL * dt;
    } else if (fwdInp < 0) {
      var brk = 22 * dt;
      if (sp2 <= brk) { p.vx = 0; p.vz = 0; } else { p.vx -= (p.vx / sp2) * brk; p.vz -= (p.vz / sp2) * brk; }
    } else {
      p.vx *= (1 - 0.42 * dt); p.vz *= (1 - 0.42 * dt);
    }
    // carving pumps speed (lean into the turn like a real pump track)
    if (turnInp !== 0 && sp2 > 3) {
      p.vx += rx * turnInp * PUMP_GAIN * dt * 1.4;
      p.vz += rz * turnInp * PUMP_GAIN * dt * 1.4;
      p.crouch = Math.min(1, p.crouch + 3 * dt);
    } else {
      p.crouch = approach(p.crouch, 0, 3.2, dt);
    }
    var sp3 = Math.hypot(p.vx, p.vz);
    if (sp3 > MAX_SPEED) { p.vx *= MAX_SPEED / sp3; p.vz *= MAX_SPEED / sp3; sp3 = MAX_SPEED; }
    p.speed = sp3;
    if (sp3 > 0.4) p.heading += turnInp * TURN_RATE * dt * clamp(sp3 / MAX_SPEED, 0.25, 1);
    p.x += p.vx * dt; p.z += p.vz * dt;
    p.pushPhase += sp3 * dt * 0.9;

    // manual scoring
    if (p.state === 'manual') {
      p.manualTimer += dt;
      p.manualPts = Math.min(400, p.manualTimer * 95);
      p.comboTimer = 0.9;
      if (!inp.manual) { p.state = 'roll'; bankCombo(p, 'manual'); }
    }

    // statue of liberty idle -> bail after standing still
    if (sp3 < 0.55) {
      p.statTimer += dt;
      if (p.statTimer > STAT_TIME && p.state !== 'statue') { p.state = 'statue'; }
    } else p.statTimer = 0;
    if (p.state === 'statue' && sp3 > 1.2) p.state = 'roll';
    else if (wasStatue && p.state === 'roll') p.state = 'statue';

    // jump
    if (inp.jump && !wasStatue) {
      p.state = 'air';
      p.vy = JUMP_V * (0.82 + 0.18 * (1 - p.crouch));
      p.y += 0.06;
      p.airTime = 0; p.lastX = p.x; p.lastZ = p.z;
      p.crouch = 0;
      addAutoTrick(p, 'Ollie', 10);
      p.groundHint = null;
    }

    // try to catch a grind from the ground (ollie onto a rail happens in air path)
    if (p.state === 'roll' || p.state === 'manual') {
      var g2 = findGrind(w, p, p.y);
      if (g2 && sp3 > 3.2 && g2.seg.kind === 'grind') {
        p.state = 'grind'; p.grindSeg = g2.seg; p.grindT = g2.t; p.grindDir = g2.dir;
        p.grindSpeed = Math.max(4.0, sp3 * 0.9);
        p.grinding = true;
        p.y = g2.seg.top - GRIND_DROP;
        addAutoTrick(p, GRIND_NAMES[grindKindFor(p, g2.seg)], g2.seg.railKind === 'rail' ? 120 : 95);
      }
    }

    var hitWall = resolveWalls(w, p, p.y);
    if (hitWall && sp3 > 11) bail(p, 'slammed a wall');

    // world bounds
    var b = w.bounds;
    if (p.x < b.x0 - 30) { p.x = b.x0 - 30; p.vx = Math.abs(p.vx); }
    if (p.x > w.bounds.x1 + 150) { p.x = w.bounds.x1 + 150; p.vx = -Math.abs(p.vx); }
    if (p.z < b.z0 - 60) { p.z = b.z0 - 60; p.vz = Math.abs(p.vz); }
    if (p.z > b.z1 + 60) { p.z = b.z1 + 60; p.vz = -Math.abs(p.vz); }
    return p;
  }

  function bankComboKeep(p) { /* combo continues through the grind */ }

  function addAutoTrick(p, name, pts) {
    if (p.combo.some(function (c) { return c.name === name; })) return;
    p.combo.push({ id: 'auto:' + name, name: name, pts: pts, t: 0 });
  }


  // ---------------------------------------------------------------- camera
  function updateCamera(cam, p, dt, w) {
    var hx = Math.cos(p.heading), hz = Math.sin(p.heading);
    var speed = Math.hypot(p.vx, p.vz);
    var back = 7.4 + clamp(speed * 0.26, 0, 3.4);
    if (p.state === 'air') back += clamp(p.airTime * 1.9, 0, 2.6);
    if (p.state === 'grind') back += 1.1;
    var tx = p.x - hx * back, tz = p.z - hz * back;
    var ty = p.y + 3.5 + clamp(speed * 0.08, 0, 1.2) + (p.state === 'air' ? clamp(p.airTime * 1.4, 0, 2.2) : 0);
    var k = 1 - Math.pow(0.0016, dt);
    cam.x = lerp(cam.x || tx, tx, k);
    cam.y = lerp(cam.y || ty, ty, k);
    cam.z = lerp(cam.z || tz, tz, k);
    // look slightly ahead of the skater
    var lx = p.x + hx * 3.2, lz = p.z + hz * 3.2, ly = p.y + 1.15;
    cam.lx = lerp(cam.lx || lx, lx, 1 - Math.pow(0.0006, dt));
    cam.ly = lerp(cam.ly || ly, ly, 1 - Math.pow(0.0006, dt));
    cam.lz = lerp(cam.lz || lz, lz, 1 - Math.pow(0.0006, dt));
    // fish-eye-ish fov kick for speed / air
    cam.fov = lerp(cam.fov || 62, 62 + clamp(speed * 0.85, 0, 16) + (p.state === 'air' ? 6 : 0), 1 - Math.pow(0.02, dt));
    void w;
  }

  // ------------------------------------------------------------- minimap
  // Pure layout so headless tests can assert HUD/controls never overlap.
  function hudLayout(vw, vh, touch) {
    var pad = Math.max(8, Math.round(Math.min(vw, vh) * 0.022));
    var L = { viewport: { x: 0, y: 0, w: vw, h: vh }, panels: [], controls: [] };
    var scoreH = Math.round(Math.min(96, vh * 0.16));
    L.panels.push({ id: 'score', x: pad, y: pad, w: Math.min(280, vw * 0.46), h: scoreH });
    var mm = Math.round(clamp(Math.min(vw, vh) * 0.24, 96, 190));
    L.panels.push({ id: 'minimap', x: vw - pad - mm, y: pad, w: mm, h: mm });
    var spotW = Math.min(320, vw * 0.52), spotH = Math.round(Math.min(52, vh * 0.09));
    L.panels.push({ id: 'spot', x: (vw - spotW) / 2, y: pad, w: spotW, h: spotH });
    var msgH = Math.round(Math.min(70, vh * 0.11));
    L.panels.push({ id: 'msg', x: (vw - Math.min(520, vw * 0.8)) / 2, y: vh * 0.19, w: Math.min(520, vw * 0.8), h: msgH });
    // Help legend lives bottom-left on desktop (no controls there). On touch
    // the left thumb owns that corner for the stick, so dock help under the
    // spot banner at top-centre instead -- never shrink it to zero.
    if (touch) {
      var r = clamp(Math.min(vw, vh) * 0.14, 52, 92);
      var cy = vh - pad - r;
      L.controls.push({ id: 'stickL', x: pad + 6, y: cy - r, w: r * 2, h: r * 2, kind: 'stick', side: 'left' });
      var bx = vw - pad - r, by = vh - pad - r;
      L.controls.push({ id: 'btnJump', x: bx, y: by, w: r, h: r, kind: 'button' });
      L.controls.push({ id: 'btnFlip', x: bx - r - 8, y: by, w: r, h: r, kind: 'button' });
      L.controls.push({ id: 'btnSpin', x: bx, y: by - r - 8, w: r, h: r, kind: 'button' });
      L.controls.push({ id: 'btnManual', x: bx - r - 8, y: by - r - 8, w: r, h: r, kind: 'button' });
      // dock help below the spot banner, sized to fit but never degenerate
      var helpW = Math.min(320, vw - 2 * pad);
      var topY = pad + spotH + pad;
      var availH = (cy - r) - topY - pad;
      var helpH = clamp(availH, 40, 120);
      L.panels.push({ id: 'help', x: (vw - helpW) / 2, y: topY, w: helpW, h: helpH });
    } else {
      var helpW2 = Math.min(300, vw * 0.44), helpH2 = Math.round(Math.min(120, vh * 0.2));
      L.panels.push({ id: 'help', x: pad, y: vh - pad - helpH2, w: helpW2, h: helpH2 });
    }
    return L;
  }

  function rectsOverlap(a, b) {
    return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
  }

  var KEYMAP = {
    KeyW: 'fwd', ArrowUp: 'fwd',
    KeyS: 'back', ArrowDown: 'back',
    KeyA: 'left', ArrowLeft: 'left',
    KeyD: 'right', ArrowRight: 'right',
    Space: 'jump',
    ShiftLeft: 'shift', ShiftRight: 'shift',
    KeyC: 'manual', ControlLeft: 'manual',
    KeyH: 'holdTrick'
  };
  var TRIGGERMAP = {
    KeyQ: { shift: 'shove', plain: 'kickflip' },
    KeyE: { shift: '360shove', plain: 'heelflip' },
    KeyF: { shift: null, plain: 'fs180' },
    KeyG: { shift: null, plain: 'fs360' },
    KeyJ: { shift: null, plain: 'bs180' },
    KeyK: { shift: null, plain: 'fs50' }
  };

  function makeInput() {
    return {
      fwd: false, back: false, left: false, right: false, jump: false,
      manual: false, shift: false, holdTrick: false,
      pressed: []
    };
  }

  function keyDown(inp, code) {
    if (KEYMAP[code]) { inp[KEYMAP[code]] = true; return null; }
    var t = TRIGGERMAP[code];
    if (!t) return null;
    var id = inp.shift ? t.shift : t.plain;
    if (!id) return null;
    inp.pressed.push(id);
    return id;
  }
  function keyUp(inp, code) {
    if (KEYMAP[code]) inp[KEYMAP[code]] = false;
  }
  function consumePressed(inp) { var a = inp.pressed.slice(); inp.pressed.length = 0; return a; }

  var CORE = {
    DEG: DEG, GRAV: GRAV, JUMP_V: JUMP_V, MAX_SPEED: MAX_SPEED, HANGTIME: HANGTIME,
    TRICKS: TRICKS, TRICK_BY_ID: TRICK_BY_ID, GRIND_NAMES: GRIND_NAMES, PAL: PAL,
    mulberry32: mulberry32, clamp: clamp, lerp: lerp, wrapAngle: wrapAngle, angDist: angDist,
    makeWorld: makeWorld, buildWorld: buildWorld, addBox: addBox, addSeg: addSeg,
    addRail: addRail, addRamp: addRamp, addLedge: addLedge, cornersOf: cornersOf,
    closestOnSeg: closestOnSeg, surfaceAt: surfaceAt, resolveWalls: resolveWalls,
    findGrind: findGrind, grindKindFor: grindKindFor,
    makePlayer: makePlayer, step: step, startTrick: startTrick, bail: bail,
    comboValue: comboValue, bankCombo: bankCombo, addAutoTrick: addAutoTrick,
    grounded: grounded, updateCamera: updateCamera, hudLayout: hudLayout,
    rectsOverlap: rectsOverlap, makeInput: makeInput, keyDown: keyDown, keyUp: keyUp,
    consumePressed: consumePressed, KEYMAP: KEYMAP, TRIGGERMAP: TRIGGERMAP,
    spotName: spotName
  };
  global.CORE = CORE;
  if (typeof module !== 'undefined' && module.exports) module.exports = CORE;
})(typeof window !== 'undefined' ? window : globalThis);


