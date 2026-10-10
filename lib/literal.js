'use strict';
// Codility-style literals used for examples, hidden tests and test-input.txt:
//   [1, 3, 6]   'abc'   "abc"   ([3, 8, 9], 3)   [[1, 2], [3, 4]]   True / False   2.5
// A case line is "<input>" or "<input> -> <expected>" (=> also accepted).

const TYPES = ['int', 'long', 'double', 'boolean', 'String', 'int[]', 'long[]', 'double[]', 'boolean[]', 'String[]', 'int[][]'];
const SCALARS = ['int', 'long', 'double', 'boolean'];

class Parser {
  constructor(s) {
    this.s = s;
    this.p = 0;
  }
  ws() {
    while (this.p < this.s.length && /\s/.test(this.s[this.p])) this.p++;
  }
  peek(str) {
    return this.s.startsWith(str, this.p);
  }
  fail(msg) {
    throw new Error(`${msg} at column ${this.p + 1}`);
  }
  value() {
    this.ws();
    const s = this.s;
    const c = s[this.p];
    if (c === '[' || c === '(') {
      const close = c === '[' ? ']' : ')';
      this.p++;
      const items = [];
      this.ws();
      if (s[this.p] === close) {
        this.p++;
        return c === '(' ? { tuple: items } : items;
      }
      for (;;) {
        items.push(this.value());
        this.ws();
        if (s[this.p] === ',') {
          this.p++;
          this.ws();
          if (s[this.p] === close) {
            this.p++;
            break;
          }
          continue;
        }
        if (s[this.p] === close) {
          this.p++;
          break;
        }
        this.fail(`expected "," or "${close}"`);
      }
      return c === '(' ? { tuple: items } : items;
    }
    if (c === "'" || c === '"') {
      this.p++;
      let str = '';
      while (this.p < s.length && s[this.p] !== c) {
        if (s[this.p] === '\\' && this.p + 1 < s.length) {
          const e = s[++this.p];
          str += e === 'n' ? '\n' : e === 't' ? '\t' : e;
        } else str += s[this.p];
        this.p++;
      }
      if (s[this.p] !== c) this.fail('unterminated string');
      this.p++;
      return str;
    }
    const num = /^[-−]?(\d[\d_]*)(\.\d+)?([eE][-+]?\d+)?/.exec(s.slice(this.p));
    if (num) {
      this.p += num[0].length;
      return Number(num[0].replace('−', '-').replace(/_/g, ''));
    }
    const word = /^(True|False|true|false)\b/.exec(s.slice(this.p));
    if (word) {
      this.p += word[0].length;
      return word[0].toLowerCase() === 'true';
    }
    this.fail(`unexpected "${s[this.p] || 'end of line'}"`);
  }
  atArrow() {
    this.ws();
    return this.peek('->') || this.peek('=>');
  }
}

/** Parse one literal value (the whole string must be consumed). */
function parseValue(text) {
  const ps = new Parser(text);
  const v = ps.value();
  ps.ws();
  if (ps.p !== text.length) ps.fail(`unexpected "${text[ps.p]}"`);
  return v;
}

/**
 * Parse "<input> [-> <expected>]" for a function with `arity` parameters.
 * Multiple arguments may be written as (a, b) or a, b.
 * Returns { args, expected?, hasExpected }.
 */
function parseCaseLine(line, arity) {
  const ps = new Parser(line);
  const values = [ps.value()];
  ps.ws();
  while (ps.s[ps.p] === ',') {
    ps.p++;
    values.push(ps.value());
    ps.ws();
  }
  let args;
  if (values.length === 1 && values[0] && values[0].tuple && (arity !== 1 || values[0].tuple.length === 1)) {
    args = values[0].tuple;
  } else {
    args = values;
  }
  args = args.map(untuple);
  let expected;
  let hasExpected = false;
  if (ps.atArrow()) {
    ps.p += 2;
    expected = untuple(ps.value());
    hasExpected = true;
  }
  ps.ws();
  if (ps.p !== line.length) ps.fail(hasExpected ? `unexpected "${line[ps.p]}"` : `expected "->" or end of line, found "${line[ps.p]}"`);
  if (args.length !== arity) throw new Error(`expected ${arity} argument${arity === 1 ? '' : 's'}, got ${args.length}`);
  return { args, expected, hasExpected };
}

function untuple(v) {
  if (v && v.tuple) return v.tuple.map(untuple);
  if (Array.isArray(v)) return v.map(untuple);
  return v;
}

function typeOk(v, type) {
  switch (type) {
    case 'int':
      return Number.isInteger(v) && v >= -2147483648 && v <= 2147483647;
    case 'long':
      return Number.isInteger(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER;
    case 'double':
      return typeof v === 'number' && Number.isFinite(v);
    case 'boolean':
      return typeof v === 'boolean';
    case 'String':
      return typeof v === 'string';
    default:
      if (type.endsWith('[]')) {
        const inner = type.slice(0, -2);
        return Array.isArray(v) && v.every((x) => typeOk(x, inner));
      }
      return false;
  }
}

function typeName(type) {
  return {
    int: 'an integer',
    long: 'an integer',
    double: 'a number',
    boolean: 'True or False',
    String: "a string like 'abc'",
    'int[]': 'an integer array like [1, 2, 3]',
    'long[]': 'an integer array like [1, 2, 3]',
    'double[]': 'a number array like [1.5, 2]',
    'boolean[]': 'an array like [True, False]',
    'String[]': "a string array like ['ab', 'c']",
    'int[][]': 'a 2D array like [[1, 2], [3, 4]]',
  }[type];
}

// ---------- display ----------

function fmtValue(v, maxItems = 40) {
  if (typeof v === 'string') {
    return v.length > 200 ? `'${v.slice(0, 200)}...' (length=${v.length})` : `'${v}'`;
  }
  if (Array.isArray(v)) {
    if (v.length > maxItems) {
      const head = v.slice(0, maxItems).map((x) => fmtValue(x, 5)).join(', ');
      return `[${head}, ...] (length=${v.length})`;
    }
    return '[' + v.map((x) => fmtValue(x, maxItems)).join(', ') + ']';
  }
  if (v === null || v === undefined) return 'None';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  return String(v);
}

function fmtArgs(args) {
  return args.length === 1 ? fmtValue(args[0]) : '(' + args.map((a) => fmtValue(a)).join(', ') + ')';
}

// ---------- comparison ----------

function sameValue(a, b, type) {
  const loose = type && type.startsWith('double');
  const eq = (x, y) => {
    if (Array.isArray(x) || Array.isArray(y)) {
      return Array.isArray(x) && Array.isArray(y) && x.length === y.length && x.every((xi, i) => eq(xi, y[i]));
    }
    if (typeof x === 'number' && typeof y === 'number') {
      if (loose) return Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(y));
      return x === y || (x === 0 && y === 0);
    }
    return x === y;
  };
  return eq(a, b);
}

/** Size of an input for complexity estimation: longest array/string (rows*cols for 2D). */
function sizeOf(args) {
  let n = 0;
  for (const a of args) {
    if (typeof a === 'string') n = Math.max(n, a.length);
    else if (Array.isArray(a)) {
      const cells = a.length && Array.isArray(a[0]) ? a.reduce((k, r) => k + r.length, 0) : a.length;
      n = Math.max(n, cells);
    }
  }
  return n;
}

module.exports = { TYPES, SCALARS, parseValue, parseCaseLine, typeOk, typeName, fmtValue, fmtArgs, sameValue, sizeOf };
