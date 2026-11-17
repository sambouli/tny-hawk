'use strict';
// Headless test harness for tny-hawk. Loads the SHIPPING inline script from
// index.html into a vm sandbox and exercises CORE directly (no DOM needed).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(HTML, 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) { console.error('no inline script found'); process.exit(1); }
const src = m[1];
// Extract just the CORE IIFE (pure logic, no DOM) so we can run it under Node.
const coreStart = src.indexOf('(function (global) {');
const renderMarker = src.indexOf('// ===================== RENDER + GAME SHELL');
if (coreStart < 0 || renderMarker < 0) { console.error('CORE boundaries not found'); process.exit(1); }
const coreSrc = src.slice(coreStart, renderMarker);

const sandbox = { module: { exports: {} }, console, Math, Date, JSON };
vm.createContext(sandbox);
new vm.Script(coreSrc).runInContext(sandbox);
const C = sandbox.CORE;
if (!C) { console.error('CORE did not export'); process.exit(1); }

let passed = 0, failed = 0, sectionName = '';
function section(t) { sectionName = t; console.log('\n== ' + t); }
function ok(cond, msg, extra) {
  if (cond) { passed++; }
  else { failed++; console.log('  FAIL ' + msg + (extra !== undefined ? ' :: ' + extra : '')); }
}

module.exports = { C, section, ok, get counts() { return { passed, failed }; } };
