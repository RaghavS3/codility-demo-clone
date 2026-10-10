'use strict';
// "Run code": examples + test-input.txt.  "Submit": examples + hidden tests.

const { execute } = require('./runner');
const L = require('./literal');

const LANG_TIME_FACTOR = { java: 1, javascript: 1, python: 4 };
const MAX_CUSTOM_TESTS = 10;

function verdict(res, expected, limitMs, returns) {
  if (!res) return { status: 'RUNTIME ERROR', detail: 'no result' };
  if (res.status === 'error') return { status: 'RUNTIME ERROR', detail: 'tested program terminated with exit code 1', error: res.error };
  if (res.status === 'timeout') {
    const shown = res.killed ? `>${(res.ms / 1000).toFixed(2)}` : (res.ms / 1000).toFixed(2);
    return { status: 'TIMEOUT ERROR', detail: `running time: ${shown} sec., time limit: ${(limitMs / 1000).toFixed(2)} sec.` };
  }
  let got;
  try {
    got = JSON.parse(res.ret);
  } catch {
    got = res.ret;
  }
  if (expected !== undefined && !L.sameValue(got, expected, returns)) {
    return { status: 'WRONG ANSWER', detail: `got ${L.fmtValue(got)} expected ${L.fmtValue(expected)}`, got };
  }
  return { status: 'OK', got };
}

function customCases(q, text) {
  const cases = [];
  const errors = [];
  String(text || '')
    .split('\n')
    .forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line.startsWith('#') || line.startsWith('//')) return;
      try {
        const c = L.parseCaseLine(line, q.params.length);
        const bad = q.params.findIndex((p, k) => !L.typeOk(c.args[k], p.type));
        if (bad >= 0) throw new Error(`${q.params[bad].name} should be ${L.typeName(q.params[bad].type)}`);
        cases.push({ args: c.args, expected: c.hasExpected ? c.expected : undefined });
      } catch (e) {
        errors.push(`test-input.txt line ${i + 1}: ${e.message}`);
      }
    });
  if (cases.length > MAX_CUSTOM_TESTS) {
    errors.push(`only the first ${MAX_CUSTOM_TESTS} test cases are used`);
    cases.length = MAX_CUSTOM_TESTS;
  }
  return { cases, errors };
}

async function run(q, lang, code, testInput) {
  const limitMs = q.timeLimit * 1000 * (LANG_TIME_FACTOR[lang] || 1);
  const custom = customCases(q, testInput);
  const all = q.examples.map((c) => ({ ...c, kind: 'example' })).concat(custom.cases.map((c) => ({ ...c, kind: 'custom' })));
  const r = await execute({ lang, code, params: q.params, cases: all.map((c) => ({ args: c.args, limitMs })) });
  const out = { compile: r.compile, inputErrors: custom.errors, items: [], hiddenCount: q.tests.length };
  if (!r.compile.ok) return out;
  all.forEach((c, i) => {
    const res = r.results[i];
    const v = verdict(res, c.expected, limitMs, q.returns);
    out.items.push({
      kind: c.kind,
      input: L.fmtArgs(c.args),
      status: c.kind === 'custom' && c.expected === undefined && v.status === 'OK' ? 'RETURNED' : v.status,
      returned: v.got !== undefined ? L.fmtValue(v.got) : '',
      detail: v.detail || '',
      error: v.error || '',
      out: (res && res.out) || '',
    });
  });
  return out;
}

async function submit(q, lang, code) {
  const limitMs = q.timeLimit * 1000 * (LANG_TIME_FACTOR[lang] || 1);
  const all = q.examples.map((c) => ({ ...c, kind: 'example' })).concat(q.tests.map((c) => ({ ...c, kind: 'hidden' })));
  const r = await execute({ lang, code, params: q.params, cases: all.map((c) => ({ args: c.args, limitMs })) });
  const cases = all.map((c, i) => {
    if (!r.compile.ok) return { kind: c.kind, status: 'COMPILATION ERROR', detail: '', ms: 0 };
    const res = r.results[i];
    const v = verdict(res, c.expected, limitMs, q.returns);
    return {
      kind: c.kind,
      input: L.fmtArgs(c.args),
      status: v.status,
      detail: v.detail || '',
      error: v.error ? v.error.split('\n').slice(0, 4).join('\n') : '',
      ms: res ? Math.round(res.ms * 1000) / 1000 : 0,
    };
  });
  const passed = cases.filter((c) => c.status === 'OK').length;
  return {
    id: q.id,
    title: q.title,
    lang,
    compile: r.compile,
    passed,
    total: cases.length,
    score: cases.length ? Math.round((100 * passed) / cases.length) : 0,
    cases,
    solution: q.solution,
  };
}

module.exports = { run, submit };
