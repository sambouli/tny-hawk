#!/usr/bin/env node
'use strict';
// Build tny-hawk: concatenate vendor/three.inline.js + src/core.js + src/render.js
// into a single self-contained index.html. Refuses to emit if the assembled inline
// script does not parse (V8 gate), so a corrupted part can never ship.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const three  = read('vendor/three.inline.js');
const core   = read('src/core.js');
const render = read('src/render.js');

const BANNER_CORE   = '// ===================== CORE (pure logic, no DOM) =====================\n';
const BANNER_RENDER = '// ===================== RENDER + GAME SHELL (DOM) =====================\n';

const inline = three + BANNER_CORE + core + BANNER_RENDER + render;

// --- syntax gate: never emit an unparsable artifact ---
try {
  new vm.Script(inline);
} catch (e) {
  console.error('SYNTAX GATE FAILED in assembled source\n' + e.message);
  process.exit(1);
}

const template = read('template.html');
if (!template.includes('/*__INLINE__*/')) {
  console.error('template.html missing /*__INLINE__*/ placeholder');
  process.exit(1);
}
const html = template.replace('/*__INLINE__*/', () => inline);

const out = path.join(ROOT, 'index.html');
fs.writeFileSync(out, html);
console.log('built ' + out + '  ' + Math.round(html.length / 1024) + ' KB');
