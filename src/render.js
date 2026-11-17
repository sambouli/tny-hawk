if (typeof document !== 'undefined' && typeof window !== 'undefined') {
(function () {
  'use strict';
  var C = window.CORE;
  var clamp = C.clamp, lerp = C.lerp;

  // ---------------------------------------------------------- three setup
  var canvas = document.getElementById('gl');
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;          // without this every castShadow flag is a no-op
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;

  var scene = new THREE.Scene();
  var SKY_TOP = new THREE.Color(0x2b4f7e), SKY_MID = new THREE.Color(0x8fb3d6), SKY_LOW = new THREE.Color(0xf0c98a);
  var FOG = new THREE.Color(0xa9bfd6);
  scene.fog = new THREE.FogExp2(FOG.getHex(), 0.0042);

  var camera = new THREE.PerspectiveCamera(62, 1, 0.25, 2600);
  var cam = { x: 0, y: 6, z: -10, lx: 0, ly: 1, lz: 0, fov: 62 };

  // sky dome with a baked vertical gradient
  (function () {
    var g = new THREE.SphereGeometry(1800, 24, 16);
    var pos = g.attributes.position, cols = new Float32Array(pos.count * 3);
    var c = new THREE.Color();
    for (var i = 0; i < pos.count; i++) {
      var t = clamp(pos.getY(i) / 1800, -1, 1);
      if (t > 0.06) c.copy(SKY_MID).lerp(SKY_TOP, clamp((t - 0.06) / 0.94, 0, 1));
      else c.copy(SKY_LOW).lerp(SKY_MID, clamp((t + 0.25) / 0.31, 0, 1));
      cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    var m = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
    scene.add(new THREE.Mesh(g, m));
  })();

  // sun + IBL-ish ambient
  var hemi = new THREE.HemisphereLight(0xbcd6f2, 0x54544c, 1.15); scene.add(hemi);
  var sun = new THREE.DirectionalLight(0xffe6bd, 2.05);
  sun.position.set(-160, 210, 120);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 20; sun.shadow.camera.far = 620;
  var SH = 95;
  sun.shadow.camera.left = -SH; sun.shadow.camera.right = SH;
  sun.shadow.camera.top = SH; sun.shadow.camera.bottom = -SH;
  sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.05;
  scene.add(sun); scene.add(sun.target);
  var rim = new THREE.DirectionalLight(0x9fc4ff, 0.5); rim.position.set(120, 90, -160); scene.add(rim);

  // ------------------------------------------------------------- textures
  function cv(size) {
    var c = document.createElement('canvas'); c.width = c.height = size; return c;
  }
  function tex(c, rx, ry) {
    var t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx || 1, ry || 1);
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function noise(ctx, s, amt, alpha) {
    var d = ctx.getImageData(0, 0, s, s);
    for (var i = 0; i < d.data.length; i += 4) {
      var n = (Math.random() - 0.5) * amt;
      d.data[i] = clamp(d.data[i] + n, 0, 255);
      d.data[i + 1] = clamp(d.data[i + 1] + n, 0, 255);
      d.data[i + 2] = clamp(d.data[i + 2] + n, 0, 255);
      if (alpha !== undefined) d.data[i + 3] = alpha;
    }
    ctx.putImageData(d, 0, 0);
  }

  function asphaltTex() {
    var s = 256, c = cv(s), x = c.getContext('2d');
    x.fillStyle = '#33373d'; x.fillRect(0, 0, s, s);
    for (var i = 0; i < 2600; i++) {
      var v = 40 + Math.random() * 60;
      x.fillStyle = 'rgba(' + v + ',' + (v + 3) + ',' + (v + 8) + ',.5)';
      x.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 2.4, 1 + Math.random() * 2.4);
    }
    // tar seams + cracks
    x.strokeStyle = 'rgba(18,20,23,.75)'; x.lineWidth = 2.4;
    for (var k = 0; k < 5; k++) {
      x.beginPath(); var px = Math.random() * s, py = Math.random() * s; x.moveTo(px, py);
      for (var q = 0; q < 7; q++) { px += (Math.random() - 0.5) * 70; py += (Math.random() - 0.5) * 70; x.lineTo(px, py); }
      x.stroke();
    }
    noise(x, s, 26);
    return tex(c, 1, 1);
  }

  function concreteTex(base) {
    var s = 256, c = cv(s), x = c.getContext('2d');
    x.fillStyle = base || '#b3b8be'; x.fillRect(0, 0, s, s);
    x.strokeStyle = 'rgba(70,76,84,.30)'; x.lineWidth = 1.6;
    for (var g = 0; g <= s; g += 64) {
      x.beginPath(); x.moveTo(g, 0); x.lineTo(g, s); x.stroke();
      x.beginPath(); x.moveTo(0, g); x.lineTo(s, g); x.stroke();
    }
    for (var i = 0; i < 900; i++) {
      var v = 150 + Math.random() * 60;
      x.fillStyle = 'rgba(' + v + ',' + v + ',' + (v + 4) + ',.18)';
      x.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 5, 2 + Math.random() * 5);
    }
    noise(x, s, 16);
    return tex(c, 1, 1);
  }


  function grassTex() {
    var s = 256, c = cv(s), x = c.getContext('2d');
    x.fillStyle = '#4a6b3c'; x.fillRect(0, 0, s, s);
    for (var i = 0; i < 5200; i++) {
      var g = 78 + Math.random() * 70;
      x.strokeStyle = 'rgba(' + (g * 0.6 | 0) + ',' + g + ',' + (g * 0.45 | 0) + ',.55)';
      x.lineWidth = 1;
      var px = Math.random() * s, py = Math.random() * s;
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + (Math.random() - 0.5) * 3, py - 2 - Math.random() * 3); x.stroke();
    }
    // dirt patches
    for (var d = 0; d < 12; d++) {
      x.fillStyle = 'rgba(110,90,60,.22)';
      x.beginPath(); x.arc(Math.random() * s, Math.random() * s, 6 + Math.random() * 22, 0, 6.283); x.fill();
    }
    return tex(c, 1, 1);
  }

  function waterTex() {
    var s = 256, c = cv(s), x = c.getContext('2d');
    var gr = x.createLinearGradient(0, 0, 0, s);
    gr.addColorStop(0, '#3f6a80'); gr.addColorStop(1, '#2e4c60');
    x.fillStyle = gr; x.fillRect(0, 0, s, s);
    for (var i = 0; i < 130; i++) {
      x.strokeStyle = 'rgba(210,235,245,' + (0.05 + Math.random() * 0.16) + ')';
      x.lineWidth = 0.8 + Math.random() * 1.8;
      var yy = Math.random() * s;
      x.beginPath();
      for (var px = 0; px <= s; px += 16) x.lineTo(px, yy + Math.sin((px / s) * 9 + i) * 2.6);
      x.stroke();
    }
    return tex(c, 1, 1);
  }

  // building facade: window grid baked per style, tileable on both axes
  function facadeTex(kind, seed) {
    var s = 256, c = cv(s), x = c.getContext('2d');
    var rnd = C.mulberry32(seed >>> 0);
    var wall, winLit, winDark, frame, cols, rows;
    winLit = '#d9c68a';
    if (kind === 'brick') { wall = '#8a5943'; winDark = '#2a2b33'; frame = '#6d4433'; cols = 6; rows = 7; }
    else if (kind === 'stone') { wall = '#a49b8a'; winDark = '#2d3138'; frame = '#8b8375'; cols = 6; rows = 6; }
    else if (kind === 'glass') { wall = '#39516a'; winDark = '#22303f'; frame = '#7d8d9c'; cols = 8; rows = 8; }
    else { wall = '#c2c6cb'; winDark = '#33383f'; frame = '#9aa0a7'; cols = 7; rows = 7; }
    x.fillStyle = wall; x.fillRect(0, 0, s, s);

    if (kind === 'brick') {
      x.strokeStyle = 'rgba(60,34,24,.35)'; x.lineWidth = 1;
      for (var by = 0; by < s; by += 8) {
        x.beginPath(); x.moveTo(0, by); x.lineTo(s, by); x.stroke();
        var off = (by / 8) % 2 ? 8 : 0;
        for (var bx = off; bx < s; bx += 16) { x.beginPath(); x.moveTo(bx, by); x.lineTo(bx, by + 8); x.stroke(); }
      }
    } else if (kind === 'stone') {
      x.strokeStyle = 'rgba(90,84,72,.35)'; x.lineWidth = 1.4;
      for (var sy = 0; sy <= s; sy += s / rows) { x.beginPath(); x.moveTo(0, sy); x.lineTo(s, sy); x.stroke(); }
      for (var sx = 0; sx <= s; sx += s / cols) { x.beginPath(); x.moveTo(sx, 0); x.lineTo(sx, s); x.stroke(); }
    }

    var cw = s / cols, ch = s / rows;
    for (var r = 0; r < rows; r++) {
      for (var col = 0; col < cols; col++) {
        var wx = col * cw + cw * 0.18, wy = r * ch + ch * 0.18;
        var ww = cw * 0.64, wh = ch * 0.6;
        // frame
        x.fillStyle = frame; x.fillRect(wx - 1.5, wy - 1.5, ww + 3, wh + 3);
        var lit = rnd() < (kind === 'glass' ? 0.22 : 0.16);
        var g2 = x.createLinearGradient(wx, wy, wx + ww, wy + wh);
        if (lit) { g2.addColorStop(0, winLit); g2.addColorStop(1, '#7a6a45'); }
        else { g2.addColorStop(0, kind === 'glass' ? '#41597a' : '#3a4048'); g2.addColorStop(1, winDark); }
        x.fillStyle = g2; x.fillRect(wx, wy, ww, wh);
        if (!lit && rnd() < 0.3) { // reflection streak
          x.fillStyle = 'rgba(255,255,255,.09)';
          x.beginPath(); x.moveTo(wx, wy + wh); x.lineTo(wx + ww * 0.55, wy); x.lineTo(wx + ww, wy);
          x.lineTo(wx + ww * 0.45, wy + wh); x.closePath(); x.fill();
        }
        if (kind !== 'glass' && rnd() < 0.14) { // AC in a window
          x.fillStyle = '#8d949c'; x.fillRect(wx + ww * 0.1, wy + wh * 0.55, ww * 0.55, wh * 0.35);
        }
      }
    }
    noise(x, s, kind === 'glass' ? 8 : 18);
    var t = tex(c, 1, 1);
    t.userData = { cols: cols, rows: rows };
    return t;
  }

  function woodTex() {
    var s = 128, c = cv(s), x = c.getContext('2d');
    x.fillStyle = '#7a5636'; x.fillRect(0, 0, s, s);
    for (var i = 0; i < 46; i++) {
      x.strokeStyle = 'rgba(52,34,18,' + (0.1 + Math.random() * 0.3) + ')';
      x.lineWidth = 1 + Math.random() * 2.4;
      var yy = Math.random() * s;
      x.beginPath();
      for (var px = 0; px <= s; px += 10) x.lineTo(px, yy + Math.sin(px * 0.06 + i) * 3);
      x.stroke();
    }
    // grip tape stripes
    x.fillStyle = 'rgba(20,20,24,.55)';
    x.fillRect(0, s * 0.16, s, s * 0.1); x.fillRect(0, s * 0.72, s, s * 0.1);
    return tex(c, 1, 1);
  }

  var T_ASPHALT = asphaltTex(), T_SIDEWALK = concreteTex('#b6bbc1'), T_CONCRETE = concreteTex('#a8aeb5');
  var T_GRASS = grassTex(), T_WATER = waterTex(), T_WOOD = woodTex();
  var FACADE_CACHE = {};
  function facadeMat(kind, seed) {
    var key = kind + ':' + (seed & 7);
    if (!FACADE_CACHE[key]) {
      var t = facadeTex(kind, seed);
      FACADE_CACHE[key] = new THREE.MeshStandardMaterial({ map: t, roughness: kind === 'glass' ? 0.34 : 0.86, metalness: kind === 'glass' ? 0.32 : 0.03 });
    }
    return FACADE_CACHE[key];
  }


  // ------------------------------------------------------------- materials
  var M = {
    asphalt: new THREE.MeshStandardMaterial({ map: T_ASPHALT, roughness: 0.95, metalness: 0 }),
    sidewalk: new THREE.MeshStandardMaterial({ map: T_SIDEWALK, roughness: 0.9 }),
    concrete: new THREE.MeshStandardMaterial({ map: T_CONCRETE, roughness: 0.88 }),
    grass: new THREE.MeshStandardMaterial({ map: T_GRASS, roughness: 1 }),
    water: new THREE.MeshStandardMaterial({ map: T_WATER, roughness: 0.16, metalness: 0.55 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x9aa2ab, roughness: 0.36, metalness: 0.82 }),
    rail: new THREE.MeshStandardMaterial({ color: 0xc7ced6, roughness: 0.24, metalness: 0.9 }),
    paintYellow: new THREE.MeshStandardMaterial({ color: 0xe8c243, roughness: 0.7 }),
    paintWhite: new THREE.MeshStandardMaterial({ color: 0xe9edf2, roughness: 0.75 }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x5a4630, roughness: 0.95 }),
    leafA: new THREE.MeshStandardMaterial({ color: 0x4e7a3a, roughness: 1 }),
    leafB: new THREE.MeshStandardMaterial({ color: 0x5c8a42, roughness: 1 }),
    hydrant: new THREE.MeshStandardMaterial({ color: 0xb23a2e, roughness: 0.55 }),
    bin: new THREE.MeshStandardMaterial({ color: 0x3f4a44, roughness: 0.7 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.8 }),
    cab: new THREE.MeshStandardMaterial({ color: 0xe8b421, roughness: 0.42, metalness: 0.25 }),
    glassDark: new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.12, metalness: 0.7 }),
    wood: new THREE.MeshStandardMaterial({ map: T_WOOD, roughness: 0.72 }),
    wheel: new THREE.MeshStandardMaterial({ color: 0x1d1f24, roughness: 0.9 }),
    shirt: new THREE.MeshStandardMaterial({ color: 0xd8dde4, roughness: 0.85 }),
    pants: new THREE.MeshStandardMaterial({ color: 0x2f3a4a, roughness: 0.9 }),
    skin: new THREE.MeshStandardMaterial({ color: 0xc99a72, roughness: 0.8 }),
    cap: new THREE.MeshStandardMaterial({ color: 0xcf4b3a, roughness: 0.8 }),
    sole: new THREE.MeshStandardMaterial({ color: 0xf0f0ee, roughness: 0.85 })
  };
  var LAMP_MAT = new THREE.MeshStandardMaterial({ color: 0xfff0c0, emissive: 0xffd98a, emissiveIntensity: 1.6, roughness: 0.5 });

  var G = new THREE.Group(); scene.add(G);
  function add(geo, mat, x, y, z, opts) {
    var m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (opts) {
      if (opts.rotY) m.rotation.y = opts.rotY;
      if (opts.rotX) m.rotation.x = opts.rotX;
      if (opts.rotZ) m.rotation.z = opts.rotZ;
      if (opts.cast !== undefined) m.castShadow = opts.cast;
      if (opts.recv !== undefined) m.receiveShadow = opts.recv;
      if (opts.sx) m.scale.set(opts.sx, opts.sy || opts.sx, opts.sz || opts.sx);
    }
    G.add(m);
    return m;
  }

  var BOX = new THREE.BoxGeometry(1, 1, 1);
  var CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);
  var SPH = new THREE.SphereGeometry(0.5, 10, 8);
  var CONE = new THREE.ConeGeometry(0.5, 1, 12);

  // unit wedge for ramps: right triangle prism, slope rising toward +z
  function wedgeGeo(w, h, run) {
    var shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0); shape.lineTo(w / 2, 0); shape.lineTo(w / 2, 0);
    shape.lineTo(-w / 2, 0);
    // build via BufferGeometry instead (Shape is XY extrude; simpler to hand-build)
    void shape;
    var hw = w / 2;
    var v = [
      -hw, 0, 0, hw, 0, 0, hw, 0, run, -hw, 0, run,   // bottom quad (0..3)
      -hw, 0, run, hw, 0, run, hw, h, run, -hw, h, run // top-back quad (4..7)
    ];
    var idx = [
      0, 2, 1, 0, 3, 2,          // bottom
      4, 5, 6, 4, 6, 7,          // slope face (y=h line at back -> flat? no)
      0, 1, 5, 0, 5, 4,          // front slope from ground to top edge
      0, 4, 7, 0, 7, 3,          // left side
      1, 2, 6, 1, 6, 5           // right side
    ];
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  var WEDGE_CACHE = {};
  function wedge(w, h, run) {
    var key = (w * 10 | 0) + '_' + (h * 10 | 0) + '_' + (run * 10 | 0);
    if (!WEDGE_CACHE[key]) WEDGE_CACHE[key] = wedgeGeo(w, h, run);
    return WEDGE_CACHE[key];
  }


  // ------------------------------------------------------------- city mesh
  var world = null;
  var instBuildings = null, instFiller = null;
  var facadeMeshes = [];

  function buildCityMesh(w) {
    while (G.children.length) {
      var c = G.children.pop();
      if (c.geometry && c.userData.own) c.geometry.dispose();
    }
    facadeMeshes.length = 0;

    // ground: one big asphalt plane + sidewalk slabs per lot
    var b = w.bounds;
    var gw = (b.x1 - b.x0) + 400, gd = (b.z1 - b.z0) + 400;
    var gp = new THREE.PlaneGeometry(gw, gd, 1, 1);
    var gm = new THREE.Mesh(gp, M.asphalt.clone());
    gm.material.map = T_ASPHALT.clone(); gm.material.map.repeat.set(gw / 26, gd / 26); gm.material.map.needsUpdate = true;
    gm.rotation.x = -Math.PI / 2; gm.position.set((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2);
    gm.receiveShadow = true; G.add(gm);

    // sidewalk caps per lot
    for (var li = 0; li < w.lots.length; li++) {
      var lot = w.lots[li];
      var mat = lot.kind === 'park' ? M.grass : (lot.kind === 'plaza' ? M.concrete : M.sidewalk);
      var pg = new THREE.PlaneGeometry(lot.hw * 2, lot.hd * 2);
      var pm = new THREE.Mesh(pg, mat);
      pm.rotation.x = -Math.PI / 2;
      pm.position.set(lot.cx, 0.035, lot.cz);
      pm.receiveShadow = true; G.add(pm);
    }

    // road markings: dashed centre lines along avenues/streets
    var dashGeo = new THREE.PlaneGeometry(0.34, 3.4);
    for (var ri = 0; ri < w.roads.length; ri++) {
      var r = w.roads[ri];
      if (r.axis === 'z') {
        for (var z = r.z0 + 4; z < r.z1 - 4; z += 8) {
          var d1 = new THREE.Mesh(dashGeo, M.paintYellow);
          d1.rotation.x = -Math.PI / 2; d1.position.set(r.x, 0.045, z); G.add(d1);
        }
      } else {
        for (var x = r.x0 + 4; x < r.x1 - 4; x += 8) {
          var d2 = new THREE.Mesh(dashGeo, M.paintYellow);
          d2.rotation.x = -Math.PI / 2; d2.rotation.z = Math.PI / 2; d2.position.set(x, 0.045, r.z); G.add(d2);
        }
      }
      // crosswalks at each end
    }
    // crosswalk stripes at intersections
    var stripe = new THREE.PlaneGeometry(0.62, 3.2);
    for (var ai = 0; ai < w.avCount; ai++) {
      for (var sj = 0; sj < w.stCount; sj++) {
        var ix = w.avX(ai), iz = w.stZ(sj), rh = w.roadHalf;
        for (var k = -2; k <= 2; k++) {
          var s1 = new THREE.Mesh(stripe, M.paintWhite); s1.rotation.x = -Math.PI / 2;
          s1.position.set(ix + k * 2.2, 0.05, iz - rh - 1.7); G.add(s1);
          var s2 = new THREE.Mesh(stripe, M.paintWhite); s2.rotation.x = -Math.PI / 2;
          s2.position.set(ix + k * 2.2, 0.05, iz + rh + 1.7); G.add(s2);
          var s3 = new THREE.Mesh(stripe, M.paintWhite); s3.rotation.x = -Math.PI / 2; s3.rotation.z = Math.PI / 2;
          s3.position.set(ix - rh - 1.7, 0.05, iz + k * 2.2); G.add(s3);
          var s4 = new THREE.Mesh(stripe, M.paintWhite); s4.rotation.x = -Math.PI / 2; s4.rotation.z = Math.PI / 2;
          s4.position.set(ix + rh + 1.7, 0.05, iz + k * 2.2); G.add(s4);
        }
      }
    }

    // boxes -> merged-ish via shared geometry + per-mesh scale (fast enough at this count)
    var rndSeed = 1;
    for (var bi = 0; bi < w.boxes.length; bi++) {
      var bx = w.boxes[bi];
      var mat2 = boxMat(bx, rndSeed++);
      var msh = new THREE.Mesh(BOX, mat2);
      msh.position.set(bx.x, bx.y + bx.h / 2, bx.z);
      msh.scale.set(bx.hw * 2, bx.h, bx.hd * 2);   // boxes store HALF-extents
      if (bx.rot) msh.rotation.y = bx.rot;
      var heavy = bx.kind === 'building' || bx.kind === 'landmark' || bx.kind === 'bridge' || bx.kind === 'ledge';
      msh.castShadow = heavy; msh.receiveShadow = true;
      G.add(msh);
      if (mat2.map && (bx.kind === 'building' || bx.kind === 'landmark')) {
        facadeMeshes.push({ mesh: msh, tex: mat2.map, cols: mat2.map.userData.cols, rows: mat2.map.userData.rows });
      }
    }

    // ramps
    for (var rp = 0; rp < w.ramps.length; rp++) {
      var rm = w.ramps[rp];
      var geo = wedge(rm.w, rm.h, rm.run);
      var mm = new THREE.Mesh(geo, M.concrete);
      mm.position.set(rm.x, 0, rm.z);
      mm.rotation.y = rm.dir;
      mm.castShadow = true; mm.receiveShadow = true;
      G.add(mm);
      // coping lip on the top edge (grindable looking)
      var cop = new THREE.Mesh(new THREE.BoxGeometry(rm.w, 0.12, 0.24), M.steel);
      cop.position.set(rm.x, rm.h - 0.04, rm.z + Math.cos(rm.dir) * 0);
      cop.rotation.y = rm.dir;
      var off = rm.run - 0.12;
      cop.position.x = rm.x + Math.sin(rm.dir) * off;
      cop.position.z = rm.z + Math.cos(rm.dir) * off;
      G.add(cop);
    }

    // rails
    for (var gi = 0; gi < w.rails.length; gi++) {
      var rail = w.rails[gi];
      for (var pi = 0; pi < rail.pts.length - 1; pi++) {
        var a = rail.pts[pi], c2 = rail.pts[pi + 1];
        var dx = c2[0] - a[0], dz = c2[1] - a[1];
        var len = Math.hypot(dx, dz);
        var ang = Math.atan2(dz, dx);
        var bar = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, len, 8), M.rail);
        bar.rotation.z = Math.PI / 2; bar.rotation.y = -ang;
        bar.position.set((a[0] + c2[0]) / 2, rail.top, (a[1] + c2[1]) / 2);
        bar.castShadow = true; G.add(bar);
        if (rail.posts) {
          var n = Math.max(2, Math.round(len / 2.6));
          for (var q = 0; q <= n; q++) {
            var t = q / n;
            var post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, rail.top, 7), M.steel);
            post.position.set(a[0] + dx * t, rail.top / 2, a[1] + dz * t);
            post.castShadow = true; G.add(post);
          }
        }
      }
    }

    // trees from props
    for (var ti2 = 0; ti2 < w.props.length; ti2++) {
      var pr = w.props[ti2];
      if (pr.kind !== 'tree') continue;
      var trunk = new THREE.Mesh(CYL, M.trunk);
      trunk.position.set(pr.x, pr.h * 0.27, pr.z); trunk.scale.set(0.44, pr.h * 0.55, 0.44);
      trunk.castShadow = true; G.add(trunk);
      var lf = new THREE.Mesh(SPH, (pr.x | 0) % 2 ? M.leafA : M.leafB);
      lf.position.set(pr.x, pr.h * 0.92, pr.z); lf.scale.set(pr.h * 1.05, pr.h * 0.95, pr.h * 1.05);
      lf.castShadow = true; G.add(lf);
    }

    // lamp glow heads
    for (var si = 0; si < w.signs.length; si++) {
      var sg = w.signs[si];
      var head = new THREE.Mesh(SPH, sg.kind === 'lamp' ? LAMP_MAT : M.dark);
      head.position.set(sg.x, sg.y + (sg.kind === 'lamp' ? 0.18 : 0.55), sg.z);
      head.scale.set(sg.kind === 'lamp' ? 0.72 : 0.44, sg.kind === 'lamp' ? 0.34 : 1.15, sg.kind === 'lamp' ? 0.72 : 0.44);
      G.add(head);
    }

    // skyline filler: instanced boxes with a single facade atlas material
    var fcount = w.filler.length;
    // NB: `map:` takes a TEXTURE, not a Material. Passing the cached facade
    // material here made three crash on first render (refreshTransformUniform
    // -> 'normalMatrix.elements' undefined). Take its .map instead.
    var facadeSrc = FACADE_CACHE['stone:0'] || facadeMat('stone', 0);
    var imat = new THREE.MeshStandardMaterial({ map: facadeSrc.map || null, roughness: 0.9 });
    instFiller = new THREE.InstancedMesh(BOX, imat, fcount);
    instFiller.castShadow = false; instFiller.receiveShadow = false;
    var dummy = new THREE.Object3D();
    var colr = new THREE.Color();
    for (var fi = 0; fi < fcount; fi++) {
      var f = w.filler[fi];
      dummy.position.set(f.x, f.h / 2, f.z);
      dummy.scale.set(f.w, f.h, f.d);
      dummy.rotation.set(0, ((fi * 0.37) % 1) * 0.5 - 0.25, 0);
      dummy.updateMatrix();
      instFiller.setMatrixAt(fi, dummy.matrix);
      var shade = 0.55 + ((fi * 7919) % 100) / 260;
      colr.setRGB(shade, shade * 0.99, shade * 1.02);
      instFiller.setColorAt(fi, colr);
    }
    instFiller.instanceMatrix.needsUpdate = true;
    if (instFiller.instanceColor) instFiller.instanceColor.needsUpdate = true;
    G.add(instFiller);
  }

  function boxMat(bx, seed) {
    switch (bx.kind) {
      case 'building': case 'landmark': return facadeMat(bx.facade || 'stone', seed);
      case 'grass': return M.grass;
      case 'water': return M.water;
      case 'path': case 'plaza': case 'step': return M.concrete;
      case 'ledge': return M.concrete;
      case 'hydrant': return M.hydrant;
      case 'bin': return M.bin;
      case 'trunk': return M.trunk;
      case 'leaf': return (seed % 2) ? M.leafA : M.leafB;
      case 'pole': case 'arm': case 'ac': case 'leg': case 'cable': return M.steel;
      case 'signal': return M.dark;
      case 'cabbody': return M.cab;
      case 'cabtop': return M.glassDark;
      case 'watertank': return M.wood;
      case 'awning': return new THREE.MeshStandardMaterial({ color: bx.color || 0xb03a34, roughness: 0.8 });
      case 'lamphead': return LAMP_MAT;
      default: return M.concrete;
    }
  }


  // ------------------------------------------------------------- skater rig
  // One factory so the title-screen attract 'ghost' skater and the real
  // player are built identically (and can never drift apart).
  function makeSkaterRig(matOverride) {
  var skater = new THREE.Group();
  var boardGroup = new THREE.Group();
  var parts = {};
  (function buildSkater() {
    function box(w, h, d, mat, x, y, z) {
      var m = new THREE.Mesh(BOX, matOverride ? matOverride(mat) : mat);
      m.scale.set(w, h, d); m.position.set(x, y, z);
      m.castShadow = !matOverride; return m;
    }
    var body = new THREE.Group(); skater.add(body); parts.body = body;

    var torso = box(0.46, 0.62, 0.3, M.shirt, 0, 1.16, 0); body.add(torso); parts.torso = torso;
    var hips = box(0.42, 0.28, 0.3, M.pants, 0, 0.78, 0); body.add(hips); parts.hips = hips;
    var neck = box(0.14, 0.12, 0.14, M.skin, 0, 1.52, 0); body.add(neck);
    var head = box(0.3, 0.32, 0.3, M.skin, 0, 1.72, 0); body.add(head); parts.head = head;
    var cap = box(0.33, 0.13, 0.33, M.cap, 0, 1.9, -0.01); body.add(cap);
    var brim = box(0.3, 0.05, 0.16, M.cap, 0, 1.85, 0.2); body.add(brim);

    // arms (pivot at shoulder)
    function arm(sx) {
      var g = new THREE.Group(); g.position.set(sx * 0.28, 1.42, 0);
      var a = box(0.13, 0.56, 0.13, M.shirt, 0, -0.28, 0); g.add(a);
      var hand = box(0.12, 0.12, 0.12, M.skin, 0, -0.6, 0); g.add(hand);
      body.add(g); return g;
    }
    parts.armL = arm(-1); parts.armR = arm(1);

    // legs (pivot at hip), front leg forward on the board
    function leg(bz) {
      var g = new THREE.Group(); g.position.set(0, 0.72, bz);
      var th = box(0.17, 0.42, 0.18, M.pants, 0, -0.21, 0); g.add(th);
      var sh = box(0.15, 0.36, 0.16, M.pants, 0, -0.58, 0.02); g.add(sh);
      var shoe = box(0.19, 0.12, 0.34, M.sole, 0, -0.8, 0.06); g.add(shoe);
      body.add(g); return g;
    }
    parts.legF = leg(0.24); parts.legB = leg(-0.26);
    parts.legF.rotation.x = -0.34; parts.legB.rotation.x = 0.30;

    // board: deck + kicktails + trucks + wheels
    var deck = new THREE.Mesh(BOX, M.wood);
    deck.scale.set(0.26, 0.05, 1.02); deck.position.y = 0.075; deck.castShadow = true;
    boardGroup.add(deck);
    var nose = new THREE.Mesh(BOX, M.wood);
    nose.scale.set(0.24, 0.045, 0.16); nose.position.set(0, 0.13, 0.56); nose.rotation.x = -0.5;
    boardGroup.add(nose);
    var tail = new THREE.Mesh(BOX, M.wood);
    tail.scale.set(0.24, 0.045, 0.16); tail.position.set(0, 0.13, -0.56); tail.rotation.x = 0.5;
    boardGroup.add(tail);
    for (var s = -1; s <= 1; s += 2) {
      var truck = new THREE.Mesh(BOX, M.steel);
      truck.scale.set(0.24, 0.07, 0.1); truck.position.set(0, 0.035, s * 0.34); boardGroup.add(truck);
      for (var wq = -1; wq <= 1; wq += 2) {
        var wh = new THREE.Mesh(CYL, M.wheel);
        wh.rotation.z = Math.PI / 2;
        wh.scale.set(0.13, 0.06, 0.13);
        wh.position.set(wq * 0.13, 0.065, s * 0.34);
        boardGroup.add(wh);
        if (!parts.wheels) parts.wheels = [];
        parts.wheels.push(wh);
      }
    }
    skater.add(boardGroup);
  })();
  return { group: skater, boardGroup: boardGroup, parts: parts };
  }
  var rig = makeSkaterRig(null);
  var skater = rig.group, boardGroup = rig.boardGroup, parts = rig.parts;
  scene.add(skater);
  // ghost twin for the attract-mode demo (translucent), hidden until boot.
  // Materials are built lazily on first show so they never depend on M's init order.
  var GHOST_M = null;
  var ghostRig = makeSkaterRig(function (base) { return (GHOST_M && GHOST_M[base.uuid]) || base; });
  ghostRig.group.visible = false;
  scene.add(ghostRig.group);

  var sparkPoints = null, sparkPool = [];
    // grind sparks
    var sparkGeo = new THREE.BufferGeometry();
    var SPARKS = 180;
    var sp = new Float32Array(SPARKS * 3);
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    var sparkMat = new THREE.PointsMaterial({ color: 0xffd06a, size: 0.14, transparent: true, opacity: 0.95, depthWrite: false });
    sparkPoints = new THREE.Points(sparkGeo, sparkMat);
    sparkPoints.frustumCulled = false;
    scene.add(sparkPoints);
    sparkPool = [];
    for (var i = 0; i < SPARKS; i++) sparkPool.push({ x: 0, y: -99, z: 0, vx: 0, vy: 0, vz: 0, life: 0 });
    void SPARKS;

  function emitSparks(x, y, z, n) {
    var made = 0;
    for (var i = 0; i < sparkPool.length && made < n; i++) {
      var p = sparkPool[i];
      if (p.life > 0) continue;
      p.x = x + (Math.random() - 0.5) * 0.2; p.y = y; p.z = z + (Math.random() - 0.5) * 0.2;
      p.vx = (Math.random() - 0.5) * 3.4; p.vy = 1.4 + Math.random() * 3.2; p.vz = (Math.random() - 0.5) * 3.4;
      p.life = 0.28 + Math.random() * 0.3;
      made++;
    }
  }
  function updateSparks(dt) {
    var arr = sparkPoints.geometry.attributes.position.array;
    for (var i = 0; i < sparkPool.length; i++) {
      var p = sparkPool[i], o = i * 3;
      if (p.life > 0) {
        p.life -= dt;
        p.vy -= 14 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        if (p.y < 0.02) { p.life = 0; p.y = -99; }
        arr[o] = p.x; arr[o + 1] = p.y; arr[o + 2] = p.z;
      } else { arr[o + 1] = -99; }
    }
    sparkPoints.geometry.attributes.position.needsUpdate = true;
  }


  // ------------------------------------------------------------- audio synth
  var Audio2 = (function () {
    var ctx = null, master = null, scrapeNode = null, scrapeGain = null;
    function ensure() {
      if (ctx) return true;
      try {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC();
        master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
        // looping noise buffer for wheel scrape / landing dust
        var len = ctx.sampleRate * 1.2;
        var buf = ctx.createBuffer(1, len, ctx.sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
        var src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        var bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 1.1;
        scrapeGain = ctx.createGain(); scrapeGain.gain.value = 0;
        src.connect(bp); bp.connect(scrapeGain); scrapeGain.connect(master);
        src.start();
        scrapeNode = src;
        return true;
      } catch (e) { return false; }
    }
    function beep(f0, f1, dur, type, vol) {
      if (!ensure()) return;
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'square';
      var t = ctx.currentTime;
      o.frequency.setValueAtTime(f0, t);
      if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol === undefined ? 0.16 : vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
    }
    function thud(vol) {
      if (!ensure()) return;
      var t = ctx.currentTime;
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(48, t + 0.16);
      g.gain.setValueAtTime(vol || 0.3, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.25);
      // pop crack
      var len = ctx.sampleRate * 0.07, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
      var s = ctx.createBufferSource(); s.buffer = buf;
      var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
      var gg = ctx.createGain(); gg.gain.value = 0.22;
      s.connect(hp); hp.connect(gg); gg.connect(master); s.start(t);
    }
    return {
      resume: function () { if (ensure() && ctx.state === 'suspended') ctx.resume(); },
      pop: function () { beep(520, 900, 0.07, 'square', 0.1); thud(0.16); },
      land: function (hard) { thud(hard ? 0.4 : 0.24); },
      flip: function () { beep(300, 1500, 0.11, 'triangle', 0.13); },
      grindOn: function () { beep(1200, 2600, 0.09, 'sawtooth', 0.07); },
      score: function (n) {
        var base = 440;
        for (var i = 0; i < Math.min(5, 1 + (n / 200 | 0)); i++) {
          (function (k) { setTimeout(function () { beep(base * Math.pow(1.26, k), base * Math.pow(1.26, k), 0.1, 'square', 0.12); }, k * 70); })(i);
        }
      },
      bail: function () { beep(240, 60, 0.4, 'sawtooth', 0.16); thud(0.4); },
      scrape: function (v) { if (scrapeGain) scrapeGain.gain.value = clamp(v, 0, 0.35); }
    };
  })();

  // ------------------------------------------------------------------ HUD
  var el = {
    scVal: document.getElementById('scVal'), scSub: document.getElementById('scSub'),
    spotName: document.getElementById('spotName'), msgBig: document.getElementById('msgBig'),
    msgPts: document.getElementById('msgPts'), combo: document.getElementById('combo'),
    spVal: document.getElementById('spVal'), stVal: document.getElementById('stVal'),
    help: document.getElementById('help'), menu: document.getElementById('menu'),
    pause: document.getElementById('pause'), load: document.getElementById('load'),
    keyList: document.getElementById('keyList'), touch: document.getElementById('touch'),
    mm: document.getElementById('mm'), minimap: document.getElementById('minimap')
  };

  var HELP_LINES = [
    ['W A S D', 'push, carve, brake'],
    ['SPACE', 'ollie'],
    ['Q / E', 'kickflip · heelflip'],
    ['⇧ + Q / E', 'shove-it · 360 shove'],
    ['F / G', 'FS 180 · FS 360'],
    ['C (hold)', 'manual'],
    ['H (hold)', 'handplant on a ledge']
  ];
  (function fillHelp() {
    var h = '';
    for (var i = 0; i < HELP_LINES.length; i++) {
      var keys = HELP_LINES[i][0].split(' ').map(function (k) { return '<kbd>' + k + '</kbd>'; }).join('');
      h += '<div>' + keys + ' <span class="t">' + HELP_LINES[i][1] + '</span></div>';
    }
    el.help.innerHTML = h;
    var kh = '';
    for (var j = 0; j < HELP_LINES.length; j++) {
      kh += '<div><i>' + HELP_LINES[j][0] + '</i><span>' + HELP_LINES[j][1] + '</span></div>';
    }
    el.keyList.innerHTML = kh;
  })();

  var msgTimer = 0;
  function flash(big, pts) {
    el.msgBig.textContent = big || '';
    el.msgBig.classList.toggle('on', !!big);
    el.msgPts.textContent = pts ? ('+' + pts) : '';
    msgTimer = big ? 1.5 : 0;
  }
  function hideMsg() {
    el.msgBig.classList.remove('on'); el.msgPts.textContent = '';
  }


  // ---------------------------------------------------------------- input
  var inp = C.makeInput();
  var isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

  window.addEventListener('keydown', function (e) {
    if (e.repeat) return;
    if (attract && !running && e.code !== 'F5' && e.code !== 'F12' &&
        e.code.indexOf('F') !== 0 && !e.metaKey && !e.ctrlKey) { startPlaying(); return; }
    if (e.code === 'Escape' || e.code === 'KeyP') { togglePause(); return; }
    if (e.code === 'KeyM') { setMinimap(!minimapOn); return; }
    if (running && (document.activeElement && document.activeElement.tagName === 'BUTTON')) document.activeElement.blur();
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].indexOf(e.code) >= 0) e.preventDefault();
    var t = C.keyDown(inp, e.code);
    if (t) tryTrick(t);
  }, { passive: false });
  window.addEventListener('keyup', function (e) { C.keyUp(inp, e.code); });
  window.addEventListener('pointerdown', function () {
    if (attract && !running) startPlaying();
  }, { passive: true });
  window.addEventListener('blur', function () {
    for (var k in inp) if (typeof inp[k] === 'boolean') inp[k] = false;
    inp.pressed.length = 0;
  });

  function tryTrick(id) {
    if (!player || !running) return;
    if (player.state !== 'air') {
      // allow pre-cueing flips off the ground only if already airborne-ish
      if (player.state !== 'grind') return;
    }
    if (C.startTrick(player, id)) {
      Audio2.flip();
      var tr = C.TRICK_BY_ID[id];
      showCombo();
      void tr;
    }
  }

  // touch controls built from hudLayout so they never collide with HUD panels
  var layout = null;
  // Minimap is off by default (it crowded small/phone screens); toggle with M
  // or the on-screen MAP button. When off we hide the panel and skip drawing.
  var minimapOn = false;
  function applyHud() {
    layout = C.hudLayout(window.innerWidth, window.innerHeight, isTouch);
    var mmRect = null;
    for (var i = 0; i < layout.panels.length; i++) {
      var p = layout.panels[i];
      if (p.id === 'minimap') { mmRect = p; continue; }   // handled below with the toggle
      var node = document.getElementById(p.id);
      if (!node) continue;
      node.style.left = p.x + 'px';
      node.style.top = p.y + 'px';
      node.style.width = p.w + 'px';
      node.style.height = p.h + 'px';
    }
    // Minimap + its toggle share the top-right corner. Toggle sits at the top;
    // the map panel appears beneath it only when enabled.
    var btn = document.getElementById('mmToggle');
    if (mmRect && btn) {
      var bh = 34;
      btn.style.right = (window.innerWidth - (mmRect.x + mmRect.w)) + 'px';
      btn.style.top = mmRect.y + 'px';
      var mmNode = document.getElementById('minimap');
      if (minimapOn) {
        mmNode.style.display = '';
        mmNode.style.left = mmRect.x + 'px';
        mmNode.style.top = (mmRect.y + bh + 6) + 'px';
        mmNode.style.width = mmRect.w + 'px';
        mmNode.style.height = mmRect.h + 'px';
      } else {
        mmNode.style.display = 'none';
      }
    }
  }
  function setMinimap(on) {
    minimapOn = !!on;
    try { localStorage.setItem('tny_mm', minimapOn ? '1' : '0'); } catch (e) {}
    var b = document.getElementById('mmToggle');
    if (b) b.classList.toggle('act', minimapOn);
    applyHud();
  }
  function buildTouch() {
    el.touch.innerHTML = '';
    if (!isTouch) return;
    layout = C.hudLayout(window.innerWidth, window.innerHeight, true);
    for (var i = 0; i < layout.controls.length; i++) {
      var c = layout.controls[i];
      var d = document.createElement('div');
      d.className = 'tc'; d.id = 'tc_' + c.id;
      d.style.left = c.x + 'px'; d.style.top = c.y + 'px';
      d.style.width = c.w + 'px'; d.style.height = c.h + 'px';
      if (c.kind === 'stick') { d.innerHTML = '<div class="knob"></div>'; }
      else d.textContent = c.id === 'btnJump' ? 'OLLIE' : c.id === 'btnFlip' ? 'FLIP' : c.id === 'btnSpin' ? 'SPIN' : 'MANUAL';
      el.touch.appendChild(d);
    }
    wireTouch();
  }

  function setFlag(node, flag, on) {
    if (flag) inp[flag] = on;
    if (node) node.classList.toggle('act', !!on);
  }
  function bindHold(node, flag, onTap) {
    if (!node) return;
    var down = function (ev) {
      ev.preventDefault(); Audio2.resume();
      setFlag(node, flag, true);
      if (onTap) onTap();
    };
    var up = function (ev) { ev.preventDefault(); setFlag(node, flag, false); };
    node.addEventListener('touchstart', down, { passive: false });
    node.addEventListener('touchend', up, { passive: false });
    node.addEventListener('touchcancel', up, { passive: false });
    node.addEventListener('mousedown', down);
    window.addEventListener('mouseup', function () { setFlag(node, flag, false); });
  }

  function wireTouch() {
    var stick = document.getElementById('tc_stickL');
    var knob = stick ? stick.querySelector('.knob') : null;
    var stickId = null, cx = 0, cy = 0, R = 0;
    if (stick) {
      var rect = stick.getBoundingClientRect();
      cx = rect.left + rect.width / 2; cy = rect.top + rect.height / 2; R = rect.width * 0.42;
      var move = function (t) {
        var dx = clamp((t.clientX - cx) / R, -1, 1), dy = clamp((t.clientY - cy) / R, -1, 1);
        inp.fwd = dy < -0.3; inp.back = dy > 0.45;
        inp.left = dx < -0.32; inp.right = dx > 0.32;
        if (knob) knob.style.transform = 'translate(' + (dx * R * 0.62) + 'px,' + (dy * R * 0.62) + 'px)';
      };
      stick.addEventListener('touchstart', function (e) {
        e.preventDefault(); Audio2.resume();
        stickId = e.changedTouches[0].identifier;
        var r2 = stick.getBoundingClientRect(); cx = r2.left + r2.width / 2; cy = r2.top + r2.height / 2;
        move(e.changedTouches[0]);
      }, { passive: false });
      stick.addEventListener('touchmove', function (e) {
        e.preventDefault();
        for (var i = 0; i < e.changedTouches.length; i++) if (e.changedTouches[i].identifier === stickId) move(e.changedTouches[i]);
      }, { passive: false });
      var end = function (e) {
        for (var i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === stickId) {
            stickId = null; inp.fwd = inp.back = inp.left = inp.right = false;
            if (knob) knob.style.transform = '';
          }
        }
      };
      stick.addEventListener('touchend', end, { passive: false });
      stick.addEventListener('touchcancel', end, { passive: false });
    }
    bindHold(document.getElementById('tc_btnJump'), 'jump', null);
    bindHold(document.getElementById('tc_btnManual'), 'manual', null);
    bindHold(document.getElementById('tc_btnFlip'), null, function () {
      tryTrick(player && player.combo.some(function (c) { return c.id === 'kickflip'; }) ? 'heelflip' : 'kickflip');
    });
    bindHold(document.getElementById('tc_btnSpin'), null, function () {
      var have = {};
      if (player) for (var i = 0; i < player.combo.length; i++) have[player.combo[i].id] = 1;
      tryTrick(have.fs360 ? 'bs180' : have.bs180 ? 'fs180' : have.fs180 ? 'fs360' : 'fs180');
    });
  }


  // -------------------------------------------------------------- minimap
  var mmCtx = el.mm.getContext('2d');
  var mmCache = null;
  function drawMinimapBase(w) {
    // pre-render the static city to an offscreen canvas once
    var S = 512;
    var off = document.createElement('canvas'); off.width = off.height = S;
    var x = off.getContext('2d');
    var b = w.bounds;
    var spanX = b.x1 - b.x0, spanZ = b.z1 - b.z0;
    var sc = S / Math.max(spanX, spanZ);
    var ox = (S - spanX * sc) / 2, oz = (S - spanZ * sc) / 2;
    x.fillStyle = '#23282f'; x.fillRect(0, 0, S, S);
    function px(wx) { return ox + (wx - b.x0) * sc; }
    function pz(wz) { return oz + (wz - b.z0) * sc; }
    // roads
    x.fillStyle = '#2c313a'; x.fillRect(px(b.x0), pz(b.z0), spanX * sc, spanZ * sc);
    for (var r = 0; r < w.roads.length; r++) {
      var rd = w.roads[r];
      x.fillStyle = '#3a4049';
      if (rd.axis === 'z') x.fillRect(px(rd.x - rd.hw), pz(rd.z0), rd.hw * 2 * sc, (rd.z1 - rd.z0) * sc);
      else x.fillRect(px(rd.x0), pz(rd.z - rd.hw), (rd.x1 - rd.x0) * sc, rd.hw * 2 * sc);
    }
    // lots
    for (var li = 0; li < w.lots.length; li++) {
      var lot = w.lots[li];
      x.fillStyle = lot.kind === 'park' ? '#3d5b34' : (lot.kind === 'plaza' ? '#6e7681' : '#4b525c');
      x.fillRect(px(lot.cx - lot.hw), pz(lot.cz - lot.hd), lot.hw * 2 * sc, lot.hd * 2 * sc);
    }
    // skateable features pop in accent colour
    x.fillStyle = '#ffb02e';
    for (var gi = 0; gi < w.rails.length; gi++) {
      var rl = w.rails[gi];
      for (var pi = 0; pi < rl.pts.length - 1; pi++) {
        x.fillRect(px(rl.pts[pi][0]) - 1, pz(rl.pts[pi][1]) - 1, 3, 3);
        x.fillRect(px(rl.pts[pi + 1][0]) - 1, pz(rl.pts[pi + 1][1]) - 1, 3, 3);
      }
    }
    x.fillStyle = '#3fd2c7';
    for (var bi = 0; bi < w.boxes.length; bi++) {
      var bx = w.boxes[bi];
      if (bx.kind !== 'ledge') continue;
      if (bx.hw * 2 > 14 || bx.hd * 2 > 14) continue;
      x.fillRect(px(bx.x) - 1, pz(bx.z) - 1, 2.4, 2.4);
    }
    if (w.river) {
      x.fillStyle = '#26414f';
      x.fillRect(px(w.river.x), 0, S, S);
    }
    mmCache = { img: off, sc: sc, ox: ox, oz: oz, b: b, S: S };
  }

  function drawMinimap(p, w) {
    if (!mmCache) return;
    var S = el.mm.width, m = mmCache;
    mmCtx.clearRect(0, 0, S, S);
    mmCtx.drawImage(m.img, 0, 0, S, S);
    // view cone
    var scale = S / m.S;
    function px(wx) { return (m.ox + (wx - m.b.x0) * m.sc) * scale; }
    function pz(wz) { return (m.oz + (wz - m.b.z0) * m.sc) * scale; }
    var hx = Math.cos(p.heading), hz = Math.sin(p.heading);
    var pxp = px(p.x), pzp = pz(p.z);
    var grad = mmCtx.createRadialGradient(pxp, pzp, 2, pxp, pzp, 46);
    grad.addColorStop(0, 'rgba(255,176,46,.42)'); grad.addColorStop(1, 'rgba(255,176,46,0)');
    mmCtx.save();
    mmCtx.beginPath();
    mmCtx.moveTo(pxp, pzp);
    var a = Math.atan2(hz, hx);
    mmCtx.arc(pxp, pzp, 46, a - 0.5, a + 0.5);
    mmCtx.closePath(); mmCtx.fillStyle = grad; mmCtx.fill();
    mmCtx.restore();
    // nearby spot markers
    mmCtx.font = '700 13px system-ui,sans-serif';
    if (w.spots) {
      for (var i = 0; i < w.spots.length; i++) {
        var s = w.spots[i];
        var d = Math.hypot(s.x - p.x, s.z - p.z);
        if (d > 90) continue;
        var mx = px(s.x), my = pz(s.z);
        mmCtx.strokeStyle = 'rgba(255,255,255,.7)'; mmCtx.lineWidth = 1.6;
        mmCtx.beginPath(); mmCtx.arc(mx, my, 5, 0, 6.283); mmCtx.stroke();
      }
    }
    // player
    mmCtx.fillStyle = '#fff';
    mmCtx.beginPath(); mmCtx.arc(pxp, pzp, 3.6, 0, 6.283); mmCtx.fill();
    mmCtx.strokeStyle = '#ffb02e'; mmCtx.lineWidth = 2;
    mmCtx.beginPath(); mmCtx.moveTo(pxp, pzp); mmCtx.lineTo(pxp + hx * 11, pzp + hz * 11); mmCtx.stroke();
  }

  // ------------------------------------------------------------ pose rig
  function poseRig(rig, p, lean, dt) {
    var sk = rig.group, bg = rig.boardGroup, parts = rig.parts;
    sk.position.set(p.x, p.y, p.z);
    sk.rotation.y = -p.heading + Math.PI / 2;
    var t = (globalNow || performance.now()) * 0.001;
    var spd = Math.hypot(p.vx, p.vz);
    var crouch = p.crouch;
    // board spin (flips) is board-local roll around its long axis
    bg.rotation.set(0, p.shoveRot * 0.12, p.boardSpin);
    bg.position.set(0, 0, 0);
    parts.body.rotation.set(0, p.bodyYaw * 0.5, 0);

    lean = clamp(lean, -1, 1) * clamp(spd / 12, 0, 1);
    parts.body.rotation.z = -lean * 0.28 + (p.state === 'manual' ? (inp.back ? 0.3 : -0.1) : 0);
    parts.body.position.y = -crouch * 0.34;
    parts.torso.rotation.x = crouch * 0.42 + (p.state === 'air' ? -0.1 : 0);

    // arms out for balance, harder when airborne or grinding
    var amp = p.state === 'air' ? 1.5 : (p.state === 'grind' ? 1.2 : 0.45 + spd * 0.03);
    parts.armL.rotation.x = -Math.sin(t * 6) * 0.12 - amp * 0.5;
    parts.armR.rotation.x = Math.sin(t * 6) * 0.12 - amp * 0.35;
    parts.armL.rotation.z = 0.25 + amp * 0.55 + (p.state === 'handplant' && p.handSide < 0 ? 1.9 : 0);
    parts.armR.rotation.z = -0.25 - amp * 0.55 - (p.state === 'handplant' ? 1.9 : 0);
    if (p.state === 'handplant') parts.body.rotation.z = p.handSide * 1.15;

    // legs: crouch on takeoff/landing, tuck in air, staggered on grind
    var tuck = p.state === 'air' ? clamp(p.airTime * 1.6, 0, 1) : 0;
    parts.legF.rotation.x = -0.34 - crouch * 0.7 - tuck * 0.9 + (p.state === 'manual' ? -0.5 : 0);
    parts.legB.rotation.x = 0.30 + crouch * 0.6 + tuck * 0.5 + (p.state === 'manual' ? 0.7 : 0);
    if (p.state === 'grind') { parts.legF.rotation.x = -0.9; parts.legB.rotation.x = 0.75; }
    if (p.state === 'bail') {
      parts.body.rotation.set(t * 3 % 6.28, 0.6, 1.2);
      parts.armL.rotation.z = 2.4; parts.armR.rotation.z = -2.4;
    }
    // wheels spin with speed
    for (var i = 0; i < parts.wheels.length; i++) parts.wheels[i].rotation.x += spd * dt * 3.2;
  }

  function poseSkater(p, dt) {
    poseRig(rig, p, (inp.right ? 1 : 0) - (inp.left ? 1 : 0), dt);
  }


  // ------------------------------------------------------- attract mode
  // Title-screen demo: a translucent 'ghost' skater runs the same bot policy
  // the headless sim uses (chase nearest rail, ollie on, spin tricks in the
  // air) while the camera orbits it. Gated by `attract` -- true only while
  // the menu is up; any key/touch/SKATE hands control to the real player.
  var globalNow = 0;   // automation can freeze the idle-animation clock
  var attract = false;
  var ghost = null, ghostInp = null, ghostCam = null, ghostAge = 0;
  var ghostTarget = null, ghostTargetAge = 0, ghostRailHits = 0, ghostFlipTimer = 0;
  var orbitAngle = 0;

  function ghostMat(base) {
    // NB: do NOT hand-build a MeshStandardMaterial here and borrow base.map --
    // the shared texture is already GPU-uploaded for the real rig and three
    // then crashes in refreshTransformUniform ('normalMatrix.elements').
    // A plain translucent colour reads as a hologram and cannot crash.
    var m = new THREE.MeshStandardMaterial({ color: base.color.clone(), roughness: base.roughness, metalness: base.metalness });
    m.transparent = true;
    m.opacity = 0.52;
    m.depthWrite = false;
    if ('emissive' in m && m.emissive) { m.emissive = new THREE.Color(0x3fd2c7); m.emissiveIntensity = 0.34; }
    return m;
  }
  function buildGhostMats() {
    if (GHOST_M) return;
    GHOST_M = {};
    for (var mk in M) GHOST_M[M[mk].uuid] = ghostMat(M[mk]);
  }

  function pickGhostTarget(w) {
    var best = null, bd = 1e18;
    for (var i = 0; i < w.segs.length; i++) {
      var seg = w.segs[i];
      if (seg.kind !== 'grind' || seg.len2 < 100) continue;
      var mx = (seg.ax + seg.bx) / 2, mz = (seg.az + seg.bz) / 2;
      var d = (mx - ghost.x) * (mx - ghost.x) + (mz - ghost.z) * (mz - ghost.z);
      if (d < bd) { bd = d; best = seg; }
    }
    ghostTarget = best; ghostTargetAge = 0;
  }

  function resetGhost() {
    if (!ghost) {
      ghost = C.makePlayer(world);
      ghostInp = C.makeInput();
      ghostCam = { x: ghost.x - 9, y: 7, z: ghost.z - 9, lx: ghost.x, ly: 1, lz: ghost.z, fov: 62 };
    } else {
      ghost.x = world.spawn.x; ghost.z = world.spawn.z; ghost.y = 0.09;
      ghost.vx = ghost.vz = ghost.vy = 0; ghost.state = 'roll';
      ghost.combo = []; ghost.manualPts = 0; ghost.boardSpin = ghost.shoveRot = ghost.bodyYaw = 0;
    }
    ghostAge = 0; ghostRailHits = 0; ghostFlipTimer = 0;
    pickGhostTarget(world);
  }

  var GHOST_TRICKS = ['kickflip', 'heelflip', 'fs180', 'fs360', 'shove', 'bs180'];
  function stepGhost(dt) {
    if (!ghost || !world) return;
    var w = world, inp = ghostInp, p = ghost;
    inp.fwd = true; inp.back = false; inp.left = inp.right = inp.jump = inp.manual = false;
    if (ghostTarget) {
      var mx = (ghostTarget.ax + ghostTarget.bx) / 2, mz = (ghostTarget.az + ghostTarget.bz) / 2;
      var dx = mx - p.x, dz = mz - p.z, dist = Math.hypot(dx, dz);
      var diff = C.angDist(Math.atan2(dz, dx), p.heading);
      inp.left = diff > 0.12; inp.right = diff < -0.12;
      if (dist < 3.2 && p.state === 'roll') inp.jump = true;
      if (dist < 2.0 || ghostTargetAge > 720) pickGhostTarget(w);
      ghostTargetAge++;
    } else {
      pickGhostTarget(w);
    }
    // periodic bail so the loop always restarts with fresh energy
    if (ghostAge > 60 * 26 && p.state === 'roll') C.bail(p, '');
    if (p.state === 'air') {
      ghostFlipTimer -= dt;
      if (ghostFlipTimer <= 0) {
        if (C.startTrick(p, GHOST_TRICKS[(Math.random() * GHOST_TRICKS.length) | 0])) {
          emitSparks(p.x, p.y, p.z, 4);
          ghostFlipTimer = 0.22;
        }
      }
    } else ghostFlipTimer = 0;
    if (p.state === 'grind') {
      emitSparks(p.x, p.y + 0.02, p.z, 2);
      if (!ghost.wasGrind) ghostRailHits++;
      p.wasGrind = true;
    } else p.wasGrind = false;
    C.step(p, w, dt, inp);
    ghostAge += dt;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.z)) { resetGhost(); return; }
    var b = w.bounds;
    if (p.x < b.x0 - 12 || p.x > b.x1 + 12 || p.z < b.z0 - 12 || p.z > b.z1 + 12) resetGhost();
    if (ghostAge > 60 * 55) resetGhost();
    // pose the ghost from its own input lean
    poseRig(ghostRig, p, (inp.right ? 1 : 0) - (inp.left ? 1 : 0), dt);
    // orbiting chase camera
    orbitAngle += dt * 0.16;
    var spd = Math.hypot(p.vx, p.vz);
    var back = 9.5 + clamp(spd * 0.16, 0, 2.5);
    var ang = -p.heading + Math.PI / 2 + Math.sin(orbitAngle) * 0.85;
    var tx = p.x + Math.sin(ang) * back, tz = p.z + Math.cos(ang) * back;
    var ty = p.y + 4.2 + Math.sin(orbitAngle * 0.7) * 1.1;
    var k = 1 - Math.pow(0.02, dt);
    ghostCam.x = lerp(ghostCam.x, tx, k);
    ghostCam.y = lerp(ghostCam.y, Math.max(ty, p.y + 1.6), k);
    ghostCam.z = lerp(ghostCam.z, tz, k);
    var kl = 1 - Math.pow(0.005, dt);
    ghostCam.lx = lerp(ghostCam.lx, p.x, kl);
    ghostCam.ly = lerp(ghostCam.ly, p.y + 1.1, kl);
    ghostCam.lz = lerp(ghostCam.lz, p.z, kl);
    ghostCam.fov = lerp(ghostCam.fov, 60 + clamp(spd * 0.5, 0, 10) + (p.state === 'air' ? 5 : 0), 1 - Math.pow(0.05, dt));
    camera.position.set(ghostCam.x, ghostCam.y, ghostCam.z);
    camera.lookAt(ghostCam.lx, ghostCam.ly, ghostCam.lz);
    if (Math.abs(camera.fov - ghostCam.fov) > 0.01) { camera.fov = ghostCam.fov; camera.updateProjectionMatrix(); }
    sun.position.set(p.x - 160, 210, p.z + 120);
    sun.target.position.set(p.x, 0, p.z);
    sun.target.updateMatrixWorld();
  }

  function setAttract(on) {
    if (on === attract) return;
    attract = on;
    if (on) {
      buildGhostMats();
      ghostRig.group.visible = true;
      skater.visible = false;
      resetGhost();
    } else {
      skater.visible = true;
      // hand the camera to the real player smoothly
      cam.x = camera.position.x; cam.y = camera.position.y; cam.z = camera.position.z;
      cam.lx = player.x; cam.ly = player.y + 1.1; cam.lz = player.z;
      cam.fov = 62;
    }
  }

  function startPlaying() {
    if (running) return;
    Audio2.resume();
    setAttract(false);
    el.menu.classList.add('hide');
    running = true; paused = false;
    last = performance.now();
    flash('SKATE', 0);
  }


  // ------------------------------------------------------------- game state
  var player = null, running = false, paused = false, seed = (Math.random() * 1e9) | 0;
  var lastBankSeen = null, comboShown = 0;

  function newCity(s) {
    seed = s >>> 0;
    world = C.buildWorld(seed);
    buildCityMesh(world);
    drawMinimapBase(world);
    player = C.makePlayer(world);
    cam = { x: player.x - 8, y: 6, z: player.z - 8, lx: player.x, ly: 1, lz: player.z, fov: 62 };
    el.scVal.textContent = '0';
    el.scSub.innerHTML = '&nbsp;';
    if (attract) { ghost = null; resetGhost(); }
    lastBankSeen = null;
  }

  function showCombo() {
    if (!player || player.combo.length === 0) { el.combo.classList.remove('on'); return; }
    var names = [];
    for (var i = 0; i < player.combo.length; i++) names.push(player.combo[i].name);
    if (player.manualPts > 0) names.push('Manual');
    el.combo.textContent = names.join('  +  ') + '   ·   ' + C.comboValue(player);
    el.combo.classList.add('on');
    comboShown = 1;
  }

  function nearestSpot(p, w) {
    var best = null, bd = 1e9;
    if (w.spots) for (var i = 0; i < w.spots.length; i++) {
      var s = w.spots[i], d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < bd) { bd = d; best = s; }
    }
    if (w.landmarks) for (var j = 0; j < w.landmarks.length; j++) {
      var l = w.landmarks[j], d2 = Math.hypot(l.x - p.x, l.z - p.z);
      if (d2 < bd) { bd = d2; best = { name: l.name, x: l.x, z: l.z }; }
    }
    return { spot: best, dist: bd };
  }

  // ---------------------------------------------------------------- loop
  var last = performance.now(), acc = 0, gAcc = 0, FIXED = 1 / 120;
  var fpsAcc = 0, fpsN = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    var dt = (now - last) / 1000; last = now;
    if (dt > 0.25) dt = 0.25;
    if (!running || paused) {
      if (attract && !paused) {
        gAcc += dt;
        var gg = 0;
        while (gAcc >= FIXED && gg++ < 8) { stepGhost(FIXED); gAcc -= FIXED; }
        if (gg >= 8) gAcc = 0;
        updateSparks(dt);
        renderer.render(scene, camera);
      } else {
        renderOnce();
      }
      return;
    }

    // fixed-step physics for determinism
    acc += dt;
    var guard = 0;
    while (acc >= FIXED && guard++ < 8) {
      C.step(player, world, FIXED, inp);
      acc -= FIXED;
    }
    if (guard >= 8) acc = 0;

    // combo timeout -> bank it
    if (player.combo.length || player.manualPts > 0) {
      player.comboTimer -= dt;
      if (player.comboTimer <= 0 && player.state !== 'air' && player.state !== 'grind') {
        C.bankCombo(player, 'banked');
      }
      showCombo();
    } else if (comboShown) { el.combo.classList.remove('on'); comboShown = 0; }

    if (player.lastBank && player.lastBank !== lastBankSeen) {
      lastBankSeen = player.lastBank;
      flash(player.lastBank.label, player.lastBank.pts);
      Audio2.score(player.lastBank.pts);
      el.scVal.textContent = player.score.toLocaleString('en-US');
      el.scSub.textContent = 'best: ' + player.bestTrick + '  ·  lands ' + player.lands + '  ·  bails ' + player.bails;
    }
    if (player.bailWhy && player.bailTimer > 1.0) { flash(player.bailWhy, 0); Audio2.bail(); player.bailWhy = ''; }

    // audio: grind scrape
    Audio2.scrape(player.state === 'grind' ? clamp(player.grindSpeed / 14, 0.05, 0.3) : 0);
    if (player.state === 'grind') {
      emitSparks(player.x, player.y + 0.02, player.z, 2);
    }
    updateSparks(dt);
    poseSkater(player, dt);
    C.updateCamera(cam, player, dt, world);

    camera.position.set(cam.x, Math.max(cam.y, player.y + 1.2), cam.z);
    camera.lookAt(cam.lx, cam.ly, cam.lz);
    if (Math.abs(camera.fov - cam.fov) > 0.01) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }

    // shadow frustum follows the skater
    sun.position.set(player.x - 160, 210, player.z + 120);
    sun.target.position.set(player.x, 0, player.z);
    sun.target.updateMatrixWorld();

    // HUD numbers
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.2) {
      el.spVal.textContent = Math.round(Math.hypot(player.vx, player.vz) * 3.6);
      el.stVal.textContent = labelFor(player);
      var ns = nearestSpot(player, world);
      el.spotName.textContent = ns.spot ? (ns.spot.name + ' · ' + Math.round(ns.dist) + 'm') : '—';
      fpsAcc = 0; fpsN = 0;
    }
    if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) hideMsg(); }

    if (minimapOn) drawMinimap(player, world);
    renderer.render(scene, camera);
  }

  function labelFor(p) {
    switch (p.state) {
      case 'air': return 'airborne ' + p.airTime.toFixed(1) + 's';
      case 'grind': return 'GRINDING';
      case 'ledge': return 'ledge ride';
      case 'manual': return 'manual ' + Math.round(p.manualPts);
      case 'handplant': return 'handplant';
      case 'bail': return 'bailed';
      case 'statue': return 'stationary';
      default: return p.speed > 1 ? 'rolling' : 'standing';
    }
  }

  function renderOnce() {
    if (world && player) {
      poseSkater(player, 0.016);
      camera.position.set(cam.x, cam.y, cam.z);
      camera.lookAt(cam.lx, cam.ly, cam.lz);
    }
    renderer.render(scene, camera);
  }

  // --------------------------------------------------------------- resize
  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (isTouch) buildTouch();
    applyHud();
  }
  window.addEventListener('resize', resize);

  // -------------------------------------------------------------- controls
  function togglePause() {
    if (!running) return;
    paused = !paused;
    el.pause.classList.toggle('hide', !paused);
    if (paused) {
      document.getElementById('pauseStats').textContent =
        'Score ' + player.score.toLocaleString('en-US') + '  ·  best line: ' + (player.bestTrick || 'none yet') +
        '  ·  ' + player.lands + ' landed / ' + player.bails + ' bailed';
      Audio2.scrape(0);
    }
  }
  document.getElementById('btnPlay').addEventListener('click', startPlaying);
  document.getElementById('btnResume').addEventListener('click', togglePause);
  (function () {
    var b = document.getElementById('mmToggle');
    if (!b) return;
    // stopPropagation so tapping MAP during attract mode doesn't also start the game
    b.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    b.addEventListener('click', function (e) { e.stopPropagation(); setMinimap(!minimapOn); });
  })();
  document.getElementById('btnRestart').addEventListener('click', function () {
    paused = false; el.pause.classList.add('hide');
    newCity((Math.random() * 1e9) | 0);
    flash('NEW CITY', 0);
  });

  // boot
  try {
    var mmPref = '0';
    try { mmPref = localStorage.getItem('tny_mm') || '0'; } catch (e) {}
    minimapOn = (mmPref === '1');
    (function () { var b = document.getElementById('mmToggle'); if (b) b.classList.toggle('act', minimapOn); })();
    newCity(seed);
    el.load.textContent = 'ready';
    resize();
    setAttract(true);
    requestAnimationFrame(frame);
  } catch (e) {
    el.load.textContent = 'error: ' + (e && e.message ? e.message : e);
    console.error(e);
  }

  window.__game = {
    get world() { return world; },
    get player() { return player; },
    CORE: C, scene: scene, camera: camera,
    startGame: function () { document.getElementById('btnPlay').click(); },
    newCity: newCity,
    get running() { return running; },
    get paused() { return paused; },
    get attract() { return attract; },
    get ghost() { return ghost; },
    renderer: renderer,
    pumpFrames: function (n, withRender) {
      // automation helper: RAF never fires in headless browsers, so drive the
      // same code path frame() uses, n times at FIXED dt. Render only when
      // asked -- a full render costs ~1s under swiftshader and would stall
      // CDP probes that pump thousands of physics steps.
      for (var i = 0; i < n; i++) {
        if (attract) stepGhost(FIXED);
        else if (running && !paused) C.step(player, world, FIXED, inp);
      }
      updateSparks(n * FIXED);
      if (withRender) renderer.render(scene, camera);
    },
    renderNow: function () { renderer.render(scene, camera); return true; }
  };
})();
}

