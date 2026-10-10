'use strict';
// Runs solution(...) from a user file on test cases case<i>.json in a directory.
// Usage: node harness.js <solution.js> <dir> <start> <count>
// Protocol on the real stdout matches Harness.java (START / RESULT / FATAL / DONE lines prefixed with \x01).

const fs = require('fs');
const path = require('path');
const util = require('util');
const vm = require('vm');
const { performance } = require('perf_hooks');

const OUT_CAP = 8192;
const [solPath, dir, startS, countS] = process.argv.slice(2);
const start = Number(startS);
const count = Number(countS);

function proto(line) {
  fs.writeSync(1, '\x01' + line + '\n');
}

let cap = null;
function capture(s) {
  if (!cap) return;
  if (cap.size >= OUT_CAP) { cap.truncated = true; return; }
  const room = OUT_CAP - cap.size;
  if (s.length > room) { cap.truncated = true; s = s.slice(0, room); }
  cap.parts.push(s);
  cap.size += s.length;
}
const logTo = (...a) => capture(util.format(...a) + '\n');
const fakeConsole = { log: logTo, info: logTo, warn: logTo, error: logTo, debug: logTo, trace: logTo };
process.stdout.write = (s) => { capture(String(s)); return true; };
process.stderr.write = (s) => { capture(String(s)); return true; };

function describe(e) {
  if (!(e instanceof Error)) return 'Uncaught ' + util.inspect(e);
  const lines = String(e.stack || e).split('\n');
  const head = lines[0];
  const frames = lines.slice(1).filter((l) => l.includes('solution.js')).slice(0, 12);
  return [head, ...frames.map((l) => l.replace(/\(.*solution\.js/, '(solution.js').replace(/at .*solution\.js/, 'at solution.js'))].join('\n');
}

function normalize(v) {
  if (Array.isArray(v) || ArrayBuffer.isView(v)) return Array.from(v, normalize);
  if (typeof v === 'bigint') return Number(v);
  return v;
}

let solution;
try {
  const src = fs.readFileSync(solPath, 'utf8');
  const wrapper = vm.runInThisContext(
    '(function (require, console, module, exports) {' + src +
      '\n;return typeof solution === "function" ? solution : (module.exports && module.exports.solution);\n})',
    { filename: path.resolve(solPath) }
  );
  const mod = { exports: {} };
  cap = { parts: [], size: 0, truncated: false };
  solution = wrapper(require, fakeConsole, mod, mod.exports);
  cap = null;
} catch (e) {
  proto('FATAL ' + describe(e).replace(/\n/g, ' | '));
  process.exit(0);
}
if (typeof solution !== 'function') {
  proto('FATAL function solution not found. Your code must define function solution(...).');
  process.exit(0);
}

for (let i = start; i < count; i++) {
  const c = JSON.parse(fs.readFileSync(path.join(dir, `case${i}.json`), 'utf8'));
  cap = { parts: [], size: 0, truncated: false };
  proto('START ' + i);
  let ret, err = null;
  const t0 = performance.now();
  try {
    ret = solution(...c.args);
  } catch (e) {
    err = e;
  }
  const t1 = performance.now();
  const out = cap.parts.join('') + (cap.truncated ? '\n...(output truncated)' : '');
  cap = null;
  const res = { i, ms: t1 - t0, out };
  if (err !== null) res.error = describe(err);
  else res.ret = ret === undefined ? 'null' : JSON.stringify(normalize(ret));
  proto('RESULT ' + JSON.stringify(res));
}
proto('DONE');
process.exit(0);
