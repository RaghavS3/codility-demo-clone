'use strict';
// Compiles and runs a candidate solution against a list of cases, one language at a time.
// Each case runs inside a harness process; a case that runs past its hard limit gets the
// process killed, is marked as a timeout, and the harness restarts from the next case.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, '.cache');
const HARNESS = path.join(ROOT, 'harness');

// ---------- toolchains ----------

function findJavaHome() {
  const candidates = [
    process.env.JAVA_HOME,
    '/opt/homebrew/opt/openjdk@21',
    '/opt/homebrew/opt/openjdk',
    '/usr/local/opt/openjdk@21',
    '/usr/local/opt/openjdk',
  ];
  try {
    const r = spawnSync('/usr/libexec/java_home', ['-v', '21'], { encoding: 'utf8' });
    if (r.status === 0) candidates.push(r.stdout.trim());
  } catch {}
  for (const c of candidates) {
    if (c && fs.existsSync(path.join(c, 'bin', 'javac'))) return c;
  }
  return null;
}

function versionOf(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 10000 });
    if (r.status !== 0) return null;
    return (r.stdout + r.stderr).trim().split('\n')[0];
  } catch {
    return null;
  }
}

let toolchainCache = null;
function toolchains() {
  if (toolchainCache) return toolchainCache;
  const javaHome = findJavaHome();
  const javaVersion = javaHome ? versionOf(path.join(javaHome, 'bin', 'java'), ['-version']) : null;
  const pyVersion = versionOf('python3', ['--version']);
  const nodeVersion = process.version;
  const javaMajor = javaVersion && (javaVersion.match(/version "(\d+)/) || [])[1];
  const pyShort = pyVersion && pyVersion.replace('Python ', '').split('.').slice(0, 2).join('.');
  toolchainCache = {
    java: {
      id: 'java',
      label: javaMajor ? `Java ${javaMajor}` : 'Java 21',
      version: javaMajor ? `Java SE ${javaMajor}` : 'Java SE 21',
      available: Boolean(javaHome),
      javaHome,
      problem: javaHome ? null : 'JDK not found. Install one with: brew install openjdk@21',
    },
    python: {
      id: 'python',
      label: pyShort ? `Python ${pyShort.split('.')[0]}` : 'Python 3',
      version: pyVersion ? pyVersion : 'Python 3',
      available: Boolean(pyVersion),
      problem: pyVersion ? null : 'python3 not found on PATH',
    },
    javascript: {
      id: 'javascript',
      label: 'JavaScript',
      version: `Node.js ${nodeVersion.replace(/^v/, '')}`,
      available: true,
      problem: null,
    },
  };
  return toolchainCache;
}

function publicToolchains() {
  return Object.values(toolchains()).map(({ id, label, version, available, problem }) => ({ id, label, version, available, problem }));
}

// ---------- process helpers ----------

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...(opts.env || {}) } });
    let out = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      p.kill('SIGKILL');
    }, opts.timeoutMs || 60000);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out: String(e.message), killed });
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, killed });
    });
  });
}

let javaHarnessReady = null;
async function ensureJavaHarness(javaHome) {
  const outDir = path.join(CACHE, 'java-harness');
  const src = path.join(HARNESS, 'Harness.java');
  const cls = path.join(outDir, 'Harness.class');
  if (fs.existsSync(cls) && fs.statSync(cls).mtimeMs >= fs.statSync(src).mtimeMs) return outDir;
  if (!javaHarnessReady) {
    javaHarnessReady = (async () => {
      fs.mkdirSync(outDir, { recursive: true });
      const r = await run(path.join(javaHome, 'bin', 'javac'), ['-encoding', 'UTF-8', '-d', outDir, src]);
      if (r.code !== 0) throw new Error('could not compile Harness.java:\n' + r.out);
      return outDir;
    })().finally(() => {
      javaHarnessReady = null;
    });
  }
  return javaHarnessReady;
}

// Runs are serialized so timings are not skewed by parallel CPU load.
let queue = Promise.resolve();
function serialized(fn) {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

// ---------- compile ----------

async function compile(lang, code, dir) {
  const tc = toolchains()[lang];
  if (!tc) return { ok: false, output: `Unknown language ${lang}` };
  if (!tc.available) return { ok: false, output: tc.problem };

  if (lang === 'java') {
    fs.writeFileSync(path.join(dir, 'Solution.java'), code);
    const harnessDir = await ensureJavaHarness(tc.javaHome);
    const classes = path.join(dir, 'classes');
    fs.mkdirSync(classes);
    const r = await run(
      path.join(tc.javaHome, 'bin', 'javac'),
      ['-encoding', 'UTF-8', '-Xlint:none', '-nowarn', '-d', classes, 'Solution.java'],
      { cwd: dir, timeoutMs: 60000 }
    );
    const output = r.out.replace(/Solution\.java/g, 'solution.java').trim();
    if (r.code !== 0) return { ok: false, output: output || 'compilation failed' };
    return {
      ok: true,
      output,
      cmd: (start, count) => [
        path.join(tc.javaHome, 'bin', 'java'),
        ['-Xmx1g', '-XX:+UseSerialGC', '-cp', `${classes}${path.delimiter}${harnessDir}`, 'Harness', dir, String(start), String(count)],
      ],
    };
  }

  if (lang === 'python') {
    const file = path.join(dir, 'solution.py');
    fs.writeFileSync(file, code);
    const r = await run('python3', ['-I', '-c', 'import sys; compile(open(sys.argv[1]).read(), "solution.py", "exec")', file], {
      timeoutMs: 20000,
    });
    if (r.code !== 0) {
      const lines = r.out.trim().split('\n');
      const from = lines.findIndex((l) => l.includes('File "solution.py"'));
      return { ok: false, output: (from >= 0 ? lines.slice(from) : lines).join('\n') };
    }
    return {
      ok: true,
      output: '',
      cmd: (start, count) => ['python3', ['-I', path.join(HARNESS, 'harness.py'), file, dir, String(start), String(count)]],
    };
  }

  // javascript
  const file = path.join(dir, 'solution.js');
  fs.writeFileSync(file, code);
  const r = await run(process.execPath, ['--check', file], { timeoutMs: 20000 });
  if (r.code !== 0) {
    return { ok: false, output: r.out.replace(new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), 'solution.js').trim() };
  }
  return {
    ok: true,
    output: '',
    cmd: (start, count) => [process.execPath, [path.join(HARNESS, 'harness.js'), file, dir, String(start), String(count)]],
  };
}

// ---------- execute ----------

function hardLimitMs(limitMs) {
  return Math.min(Math.max(limitMs * 3, limitMs + 2000), Math.max(limitMs + 2000, 10000));
}

/**
 * Run one harness process from case `start`. Resolves with the results it produced and
 * how it ended: 'done' | 'timeout' (case index) | 'crash' | 'fatal'.
 */
function runHarness(cmd, start, count, limits, onResult) {
  return new Promise((resolve) => {
    const [bin, args] = cmd(start, count);
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    let stderr = '';
    let current = -1;
    let timer = null;
    let timedOut = -1;
    let fatal = null;
    let done = false;

    const handleLine = (line) => {
      if (!line.startsWith('\x01')) return;
      const body = line.slice(1);
      if (body.startsWith('START ')) {
        current = Number(body.slice(6));
        clearTimeout(timer);
        timer = setTimeout(() => {
          timedOut = current;
          p.kill('SIGKILL');
        }, hardLimitMs(limits[current]));
      } else if (body.startsWith('RESULT ')) {
        clearTimeout(timer);
        const r = JSON.parse(body.slice(7));
        current = -1;
        onResult(r);
      } else if (body.startsWith('FATAL ')) {
        fatal = body.slice(6);
      } else if (body === 'DONE') {
        done = true;
      }
    };

    p.stdout.on('data', (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        handleLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    });
    p.stderr.on('data', (d) => {
      if (stderr.length < 8192) stderr += d;
    });
    p.on('error', (e) => {
      clearTimeout(timer);
      resolve({ end: 'fatal', message: e.message });
    });
    p.on('close', (code, signal) => {
      clearTimeout(timer);
      if (buf) handleLine(buf);
      if (fatal) return resolve({ end: 'fatal', message: fatal });
      if (timedOut >= 0) return resolve({ end: 'timeout', index: timedOut });
      if (done) return resolve({ end: 'done' });
      resolve({ end: 'crash', index: current, code, signal, stderr: stderr.trim() });
    });
  });
}

/**
 * cases: [{ args, limitMs }]
 * returns { compile: {ok, output}, results: [{ status, ret?, ms, out, error? }] }
 *   status: 'ok' | 'error' | 'timeout'   (wrong-answer is decided by the caller)
 */
function execute({ lang, code, params, cases }) {
  return serialized(async () => {
    fs.mkdirSync(path.join(CACHE, 'runs'), { recursive: true });
    const dir = fs.mkdtempSync(path.join(CACHE, 'runs', 'r-'));
    try {
      const comp = await compile(lang, code, dir);
      if (!comp.ok) return { compile: { ok: false, output: comp.output }, results: [] };

      fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ params: params.map((p) => p.type) }));
      cases.forEach((c, i) => fs.writeFileSync(path.join(dir, `case${i}.json`), JSON.stringify({ args: c.args })));
      const limits = cases.map((c) => c.limitMs);
      const results = new Array(cases.length).fill(null);

      let next = 0;
      while (next < cases.length) {
        const ended = await runHarness(comp.cmd, next, cases.length, limits, (r) => {
          const limitMs = limits[r.i];
          if (r.error !== undefined) results[r.i] = { status: 'error', ms: r.ms, out: r.out, error: r.error };
          else if (r.ms > limitMs) results[r.i] = { status: 'timeout', ms: r.ms, out: r.out, ret: r.ret };
          else results[r.i] = { status: 'ok', ms: r.ms, out: r.out, ret: r.ret };
        });
        if (ended.end === 'fatal') {
          for (let i = next; i < cases.length; i++) {
            if (!results[i]) results[i] = { status: 'error', ms: 0, out: '', error: ended.message };
          }
          break;
        }
        if (ended.end === 'timeout') {
          results[ended.index] = { status: 'timeout', ms: hardLimitMs(limits[ended.index]), out: '', killed: true };
        } else if (ended.end === 'crash') {
          const idx = ended.index >= 0 ? ended.index : results.findIndex((r) => !r);
          if (idx >= 0) {
            const why = ended.signal ? `killed by signal ${ended.signal}` : `exit code ${ended.code}`;
            results[idx] = {
              status: 'error',
              ms: 0,
              out: '',
              error: `tested program terminated unexpectedly (${why})` + (ended.stderr ? '\n' + ended.stderr : ''),
            };
          }
        }
        let firstMissing = results.findIndex((r) => !r);
        if (firstMissing === next && ended.end === 'done') {
          // harness claimed it finished without reporting this case; never loop forever
          results[next] = { status: 'error', ms: 0, out: '', error: 'no result reported for this test' };
          firstMissing = results.findIndex((r) => !r);
        }
        next = firstMissing < 0 ? cases.length : firstMissing;
      }
      return { compile: { ok: true, output: comp.output }, results };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

module.exports = { execute, toolchains, publicToolchains, hardLimitMs, CACHE };
