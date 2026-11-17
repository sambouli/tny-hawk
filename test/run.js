'use strict';
// Run all headless test files in order, then report totals.
require('./world.test.js');
require('./mechanics.test.js');
require('./sim.test.js');
const { counts } = require('./harness.js');
console.log('\n' + counts.passed + ' passed, ' + counts.failed + ' failed');
process.exit(counts.failed ? 1 : 0);
