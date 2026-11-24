// Smoke test for the static Cloudflare Pages artifact; no browser or credentials needed.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'dist', 'index.html'), 'utf8');
assert.match(html, /<title>Лист героя<\/title>/);
assert.match(html, /peerTransport/);
assert.match(html, /runDiagnostics/);
for (const marker of ['/*CORE*/', '/*HELP*/', '/*TABLE*/', '/*NET*/', '/*TABLEUI*/', '/*TIPS*/', '/*DND5E*/', '/*GURPS*/']) {
  assert.ok(!html.includes(marker), 'Unexpanded build marker: ' + marker);
}
console.log('Cloudflare Pages static build smoke test passed');
