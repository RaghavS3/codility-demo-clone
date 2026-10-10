'use strict';
// Loads your questions from questions/*.md (one file = one task tab, in file-name order).
// File format (see README.md):
//
//   # Title
//   description... ({{signature}} marks where the signature box goes)
//   ## Signature      int solution(int[] A)
//   ## Examples       [1, 2, 3] -> 4        (shown and run by "Run code")
//   ## Tests          [5] -> 1              (hidden, only run on Submit)
//   ## Time limit     1.5                   (seconds per test, optional)
//   ## Solution       a fenced code block   (optional, shown after Submit)

const fs = require('fs');
const path = require('path');
const L = require('./literal');

const DIR = process.env.QUESTIONS_DIR ? path.resolve(process.env.QUESTIONS_DIR) : path.join(__dirname, '..', 'questions');
const LANGS = ['java', 'python', 'javascript'];

function parseSignature(text) {
  const m = /(?:public\s+)?(?:static\s+)?([A-Za-z][\w\[\]]*)\s+solution\s*\(([^)]*)\)/.exec(text);
  if (!m) throw new Error('## Signature should look like: int solution(int[] A, int K)');
  const returns = m[1];
  if (!L.TYPES.includes(returns)) throw new Error(`unsupported return type ${returns} (use one of ${L.TYPES.join(', ')})`);
  const params = m[2]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const pm = /^(?:final\s+)?([A-Za-z][\w\[\]]*)\s+([A-Za-z_]\w*)$/.exec(s);
      if (!pm) throw new Error(`can't read parameter "${s}"`);
      if (!L.TYPES.includes(pm[1])) throw new Error(`unsupported parameter type ${pm[1]} (use one of ${L.TYPES.join(', ')})`);
      return { type: pm[1], name: pm[2] };
    });
  if (!params.length) throw new Error('the solution function needs at least one parameter');
  return { params, returns };
}

function parseCases(body, q, section, errors) {
  const cases = [];
  body.forEach(({ text, line }) => {
    const raw = text.trim();
    if (!raw || raw.startsWith('#') || raw.startsWith('//') || raw.startsWith('```')) return;
    try {
      const c = L.parseCaseLine(raw, q.params.length);
      const bad = q.params.findIndex((p, i) => !L.typeOk(c.args[i], p.type));
      if (bad >= 0) throw new Error(`${q.params[bad].name} should be ${L.typeName(q.params[bad].type)}`);
      if (!c.hasExpected) throw new Error('add the expected result: input -> expected');
      if (!L.typeOk(c.expected, q.returns)) throw new Error(`expected value should be ${L.typeName(q.returns)}`);
      cases.push({ args: c.args, expected: c.expected, line });
    } catch (e) {
      errors.push(`${section}, line ${line}: ${e.message}`);
    }
  });
  return cases;
}

function parseFile(file) {
  const lines = fs.readFileSync(path.join(DIR, file), 'utf8').replace(/\r\n/g, '\n').split('\n');
  const q = {
    id: file.replace(/\.md$/, ''),
    file,
    title: file.replace(/\.md$/, '').replace(/^\d+[-_ ]*/, '') || file,
    description: '',
    params: [],
    returns: null,
    examples: [],
    tests: [],
    timeLimit: 3,
    solution: null,
    errors: [],
  };
  const sections = { description: [] };
  let current = 'description';
  let inFence = false;
  lines.forEach((text, i) => {
    if (/^\s*```/.test(text)) inFence = !inFence;
    const h1 = !inFence && /^#\s+(.+)$/.exec(text);
    const h2 = !inFence && /^##\s+(.+?)\s*$/.exec(text);
    if (h1 && current === 'description' && !sections.description.some((l) => l.text.trim())) {
      q.title = h1[1].trim();
      return;
    }
    if (h2) {
      const name = h2[1].toLowerCase();
      const key = /signature/.test(name) ? 'signature' : /example/.test(name) ? 'examples' : /test/.test(name) ? 'tests' : /time/.test(name) ? 'time' : /solution/.test(name) ? 'solution' : null;
      if (key) {
        current = key;
        sections[key] = [];
        return;
      }
    }
    (sections[current] = sections[current] || []).push({ text, line: i + 1 });
  });

  q.description = sections.description.map((l) => l.text).join('\n').trim();
  try {
    const sig = (sections.signature || []).map((l) => l.text).join(' ').trim();
    if (!sig) throw new Error('missing "## Signature" section, e.g. int solution(int[] A)');
    Object.assign(q, parseSignature(sig));
  } catch (e) {
    q.errors.push(e.message);
    return q;
  }
  q.examples = parseCases(sections.examples || [], q, 'Examples', q.errors);
  q.tests = parseCases(sections.tests || [], q, 'Tests', q.errors);
  if (sections.time) {
    const t = parseFloat(sections.time.map((l) => l.text).join(' '));
    if (t > 0) q.timeLimit = t;
  }
  if (sections.solution) {
    const text = sections.solution.map((l) => l.text).join('\n');
    const fence = /```\s*([\w+-]*)\s*\n([\s\S]*?)```/.exec(text);
    const lang = fence ? fence[1].toLowerCase() : '';
    q.solution = {
      language: { py: 'python', python: 'python', js: 'javascript', javascript: 'javascript' }[lang] || 'java',
      code: (fence ? fence[2] : text).replace(/\s+$/, ''),
    };
  }
  return q;
}

function loadAll() {
  if (!fs.existsSync(DIR)) return [];
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.md') && !f.startsWith('_') && f.toLowerCase() !== 'readme.md')
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map(parseFile);
}

function get(id) {
  return loadAll().find((q) => q.id === id) || null;
}

function signature(q, lang) {
  const names = q.params.map((p) => p.name);
  if (lang === 'java') return `class Solution { public ${q.returns} solution(${q.params.map((p) => `${p.type} ${p.name}`).join(', ')}); }`;
  if (lang === 'python') return `def solution(${names.join(', ')})`;
  return `function solution(${names.join(', ')});`;
}

function template(q, lang) {
  const names = q.params.map((p) => p.name);
  if (lang === 'java') {
    return [
      '// you can also use imports, for example:',
      '// import java.util.*;',
      '',
      '// you can write to stdout for debugging purposes, e.g.',
      '// System.out.println("this is a debug message");',
      '',
      'class Solution {',
      `    public ${q.returns} solution(${q.params.map((p) => `${p.type} ${p.name}`).join(', ')}) {`,
      '        // Implement your solution here',
      '    }',
      '}',
      '',
    ].join('\n');
  }
  if (lang === 'python') {
    return [
      '# you can write to stdout for debugging purposes, e.g.',
      '# print("this is a debug message")',
      '',
      `def solution(${names.join(', ')}):`,
      '    # Implement your solution here',
      '    pass',
      '',
    ].join('\n');
  }
  return [
    '// you can write to stdout for debugging purposes, e.g.',
    "// console.log('this is a debug message');",
    '',
    `function solution(${names.join(', ')}) {`,
    '    // Implement your solution here',
    '}',
    '',
  ].join('\n');
}

/** What the page gets: no hidden tests, no solution. */
function publicView(q) {
  return {
    id: q.id,
    file: q.file,
    title: q.title,
    description: q.description,
    errors: q.errors,
    ready: Boolean(q.returns),
    hiddenCount: q.tests.length,
    signatures: q.returns ? Object.fromEntries(LANGS.map((l) => [l, signature(q, l)])) : {},
    templates: q.returns ? Object.fromEntries(LANGS.map((l) => [l, template(q, l)])) : {},
  };
}

module.exports = { DIR, LANGS, loadAll, get, publicView };
