'use strict';
/* Demo test page: task panel, files, Monaco editor, Run code, Test Output, timer, Submit. */

const MONACO = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min';
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem('demo:' + k);
      return v === null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('demo:' + k, JSON.stringify(v));
    } catch {}
  },
};
const EXT = { java: 'java', python: 'py', javascript: 'js' };
const MONACO_LANG = { java: 'java', python: 'python', javascript: 'javascript' };
const DEFAULT_MINUTES = 30;

const S = {
  tasks: [],
  languages: [],
  cur: 0,
  editor: null,
  models: {},
  tabs: {}, // task id -> { open: ['solution','tests'], active }
  running: false,
  timerEnd: 0,
  submitted: false,
};

async function api(method, url, body) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

// ---------- theme / modal ----------

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  store.set('theme', t);
  if (window.monaco) monaco.editor.setTheme(t === 'light' ? 'demo-light' : 'demo-dark');
}

function modal(title, html, buttons = [{ label: 'Close' }], wide = false) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  $('.modal').classList.toggle('wide', wide);
  const foot = $('#modal-foot');
  foot.innerHTML = '';
  buttons.forEach((b) => {
    const el = document.createElement('button');
    el.className = b.primary ? 'btn-submit' : 'btn-ghost';
    el.textContent = b.label;
    el.onclick = () => {
      if (!b.keepOpen) closeModal();
      if (b.onClick) b.onClick();
    };
    foot.appendChild(el);
  });
  $('#modal').hidden = false;
}
function closeModal() {
  $('#modal').hidden = true;
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 1800);
}

// ---------- description rendering ----------

function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
}

function sigBox(sig) {
  return `<div class="sig-box"><span>${esc(sig)}</span><button class="icon-btn" data-copy title="Copy"><svg><use href="#i-copy"/></svg></button></div>`;
}

function renderDescription(task, lang) {
  const sig = task.signatures[lang] || '';
  const lines = task.description.split('\n');
  let html = '';
  let list = false;
  let fence = null;
  let placed = false;
  const closeList = () => {
    if (list) html += '</ul>';
    list = false;
  };
  for (const line of lines) {
    if (fence !== null) {
      if (/^\s*```/.test(line)) {
        html += `<pre>${esc(fence)}</pre>`;
        fence = null;
      } else fence += (fence ? '\n' : '') + line;
      continue;
    }
    if (/^\s*```/.test(line)) {
      closeList();
      fence = '';
      continue;
    }
    const t = line.trim();
    if (!t) {
      closeList();
      continue;
    }
    if (t === '{{signature}}' || /^(class Solution\b|def solution\s*\(|function solution\s*\()/.test(t)) {
      closeList();
      if (sig) html += sigBox(sig);
      placed = true;
      continue;
    }
    const li = /^([-*•]|\d+[.)])\s+(.*)$/.exec(t);
    if (li) {
      if (!list) html += '<ul>';
      list = true;
      html += `<li>${inline(li[2])}</li>`;
      continue;
    }
    closeList();
    html += `<p>${inline(t)}</p>`;
  }
  closeList();
  if (fence !== null) html += `<pre>${esc(fence)}</pre>`;
  if (!placed && sig) html = `<p>Write a function:</p>${sigBox(sig)}` + html;
  return html;
}

// ---------- tasks / panels ----------

function task() {
  return S.tasks[S.cur];
}

function langOf(t) {
  return store.get(`lang:${t.id}`, 'java');
}

function codeKey(t, lang) {
  return `code:${t.id}:${lang}`;
}

function renderRail() {
  $('#rail-tabs').innerHTML = S.tasks
    .map((t, i) => `<button class="rail-tab ${i === S.cur ? 'active' : ''}" data-task="${i}" title="${esc(t.title)}">${i + 1}</button>`)
    .join('');
  if (!S.tasks.length) $('#rail-tabs').innerHTML = '<button class="rail-tab active">1</button>';
}

function renderTaskPanel() {
  const t = task();
  const body = $('#task-body');
  if (!t) {
    $('#task-heading').textContent = 'Task 1';
    body.innerHTML = `<p><b>No questions yet.</b></p>
      <p>Add a <code>.md</code> file to the <code>questions/</code> folder, then reload this page. Each file becomes a task tab.</p>
      <pre># MissingInteger
Write a function:
{{signature}}
that, given an array A of N integers, returns ...

## Signature
int solution(int[] A)

## Examples
[1, 3, 6, 4, 1, 2] -&gt; 5

## Tests
[-1, -3] -&gt; 1</pre>
      <p class="muted">"Examples" run on Run code. "Tests" stay hidden and run on Submit. Optional: <code>## Time limit</code> (seconds) and <code>## Solution</code> (a code block shown after Submit). See README.md.</p>`;
    return;
  }
  $('#task-heading').textContent = `Task ${S.cur + 1}`;
  if (t.errors.length) {
    body.innerHTML = `<p><b>${esc(t.file)} needs fixing:</b></p><ul>${t.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` + (t.ready ? renderDescription(t, langOf(t)) : '');
    return;
  }
  body.innerHTML = renderDescription(t, langOf(t));
}

function renderLangUI() {
  const t = task();
  const lang = t ? langOf(t) : 'java';
  const sel = $('#lang-select');
  sel.innerHTML = S.languages.map((l) => `<option value="${l.id}" ${l.id === lang ? 'selected' : ''} ${l.available ? '' : 'disabled'}>${esc(l.label)}</option>`).join('');
  const info = S.languages.find((l) => l.id === lang);
  $('#lang-version').textContent = `Language Version: ${info ? info.version : ''}`;
  $('#solution-filename').textContent = `solution.${EXT[lang]}`;
  $('#folder-name').textContent = `task${S.cur + 1}`;
  renderTabs();
}

// ---------- editor ----------

function loadMonaco() {
  return new Promise((resolve) => {
    window.MonacoEnvironment = {
      getWorkerUrl: () =>
        'data:text/javascript;charset=utf-8,' +
        encodeURIComponent(`self.MonacoEnvironment={baseUrl:'${MONACO}/'};importScripts('${MONACO}/vs/base/worker/workerMain.js');`),
    };
    require.config({ paths: { vs: `${MONACO}/vs` } });
    require(['vs/editor/editor.main'], () => resolve(window.monaco));
  });
}

function defineThemes() {
  const rules = (c) => [
    { token: 'comment', foreground: c.comment },
    { token: 'keyword', foreground: c.keyword },
    { token: 'type', foreground: c.keyword },
    { token: 'type.identifier', foreground: c.type, fontStyle: 'bold' },
    { token: 'identifier', foreground: c.text },
    { token: 'number', foreground: c.number },
    { token: 'string', foreground: c.string },
    { token: 'delimiter', foreground: c.text },
  ];
  monaco.editor.defineTheme('demo-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: rules({ comment: 'c9c86d', keyword: '7fa8ff', type: '8fdcff', text: 'ececec', number: 'f3a35c', string: 'b9db7a' }),
    colors: {
      'editor.background': '#2b2a2d',
      'editorLineNumber.foreground': '#8b8b8e',
      'editorLineNumber.activeForeground': '#e6e6e6',
      'editor.lineHighlightBackground': '#00000000',
      'editor.lineHighlightBorder': '#45454a',
      'editorIndentGuide.background1': '#4a4a4f',
      'editorCursor.foreground': '#f5d547',
      'editor.selectionBackground': '#4b4a6b',
    },
  });
  monaco.editor.defineTheme('demo-light', {
    base: 'vs',
    inherit: true,
    rules: rules({ comment: '7a7a20', keyword: '1f4fd1', type: '006a8e', text: '1e1e20', number: 'b34d00', string: '3d7a00' }),
    colors: { 'editor.background': '#ffffff', 'editor.lineHighlightBackground': '#00000000', 'editor.lineHighlightBorder': '#e2e2e6' },
  });
}

function model(kind) {
  const t = task();
  const key = t ? `${t.id}:${kind === 'tests' ? 'tests' : langOf(t)}` : `none:${kind}`;
  if (S.models[key]) return S.models[key];
  let value;
  let language;
  if (kind === 'tests') {
    value = t ? store.get(`tests:${t.id}`, '') : '';
    language = 'plaintext';
  } else {
    const lang = t ? langOf(t) : 'java';
    value = t ? store.get(codeKey(t, lang), t.templates[lang] || '') : '';
    language = MONACO_LANG[lang];
  }
  const m = monaco.editor.createModel(value, language);
  m.onDidChangeContent(() => scheduleSave(t, kind, m));
  S.models[key] = m;
  return m;
}

let saveTimer = null;
function scheduleSave(t, kind, m) {
  if (!t) return;
  $('#save-status').textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (kind === 'tests') store.set(`tests:${t.id}`, m.getValue());
    else store.set(codeKey(t, langOf(t)), m.getValue());
    $('#save-status').textContent = 'All changes saved';
  }, 400);
}
function flushSave() {
  clearTimeout(saveTimer);
  const t = task();
  if (!t || !S.editor) return;
  const lang = langOf(t);
  const sol = S.models[`${t.id}:${lang}`];
  const tests = S.models[`${t.id}:tests`];
  if (sol) store.set(codeKey(t, lang), sol.getValue());
  if (tests) store.set(`tests:${t.id}`, tests.getValue());
  $('#save-status').textContent = 'All changes saved';
}

function tabState() {
  const id = task() ? task().id : 'none';
  if (!S.tabs[id]) S.tabs[id] = { open: ['solution'], active: 'solution' };
  return S.tabs[id];
}

function renderTabs() {
  const ts = tabState();
  const t = task();
  const lang = t ? langOf(t) : 'java';
  const name = (f) => (f === 'tests' ? 'test-input.txt' : `solution.${EXT[lang]}`);
  $('#tabbar').innerHTML = ts.open
    .map((f) => `<div class="tab ${f === ts.active ? 'active' : ''}" data-tab="${f}"><svg><use href="#i-file"/></svg>${name(f)}<button class="tab-x" data-close="${f}" title="Close"><svg><use href="#i-x"/></svg></button></div>`)
    .join('');
  document.querySelectorAll('.tree li.file').forEach((li) => li.classList.toggle('selected', li.dataset.file === ts.active));
  if (!S.editor) return;
  $('#editor-empty').hidden = Boolean(ts.active);
  $('#editor').style.visibility = ts.active ? 'visible' : 'hidden';
  if (ts.active) S.editor.setModel(model(ts.active));
}

function openFile(f) {
  const ts = tabState();
  if (!ts.open.includes(f)) ts.open.push(f);
  ts.active = f;
  renderTabs();
  if (S.editor) S.editor.focus();
}

function closeFile(f) {
  const ts = tabState();
  ts.open = ts.open.filter((x) => x !== f);
  if (ts.active === f) ts.active = ts.open[ts.open.length - 1] || null;
  renderTabs();
}

function selectTask(i) {
  flushSave();
  S.cur = i;
  renderRail();
  renderTaskPanel();
  renderLangUI();
  $('#output-body').innerHTML = '';
}

function setLanguage(lang) {
  flushSave();
  const t = task();
  if (!t) return;
  store.set(`lang:${t.id}`, lang);
  renderTaskPanel();
  renderLangUI();
}

// ---------- run code ----------

function renderRun(r) {
  const out = [];
  const add = (h) => out.push(h);
  if (!r.compile.ok) {
    add(`<div class="block"><span class="bad">Compilation failed.</span>\n${esc(r.compile.output)}</div>`);
    return out.join('');
  }
  add(`<div class="block">Compilation successful.${r.compile.output ? '\n' + esc(r.compile.output) : ''}</div>`);
  for (const e of r.inputErrors) add(`<div class="block warn">${esc(e)}</div>`);
  for (const it of r.items) {
    let h = `<div class="block"><span class="label">${it.kind === 'example' ? 'Example test:' : 'Your test case:'}</span>   ${esc(it.input)}\n`;
    if (it.out) h += `<span class="label">Output:</span>\n<span class="stdout">${esc(it.out.replace(/\n$/, ''))}</span>`;
    if (it.status === 'OK') h += '<span class="ok">OK</span>';
    else if (it.status === 'RETURNED') h += `<span class="label">Returned value:</span> ${esc(it.returned)}`;
    else {
      h += `<span class="bad">${it.status}</span> ${esc(it.detail ? '(' + it.detail + ')' : '')}`;
      if (it.error) h += `\n<span class="stdout">${esc(it.error)}</span>`;
    }
    add(h + '</div>');
  }
  const examples = r.items.filter((i) => i.kind === 'example');
  if (examples.length) {
    const allOk = examples.every((i) => i.status === 'OK');
    add(allOk ? '<div class="block">Your code is syntactically correct and works properly on the example test.</div>' : '<div class="block bad">Detected some errors.</div>');
  }
  if (r.hiddenCount) add(`<div class="block muted">Note that the example tests are not part of your score. On submission ${r.hiddenCount} more test case${r.hiddenCount === 1 ? '' : 's'} not shown here will assess your solution.</div>`);
  return out.join('');
}

async function runCode() {
  const t = task();
  if (!t || S.running) return;
  if (!t.ready) return toast(`Fix ${t.file} first`);
  flushSave();
  S.running = true;
  const btn = $('#run-btn');
  btn.disabled = true;
  btn.classList.add('running');
  btn.querySelector('span').textContent = 'Running…';
  expandOutput();
  $('#output-body').innerHTML = '<span class="placeholder">Running solution…</span>';
  const lang = langOf(t);
  try {
    const r = await api('POST', '/api/run', {
      id: t.id,
      language: lang,
      code: model('solution').getValue(),
      testInput: store.get(`tests:${t.id}`, ''),
    });
    $('#output-body').innerHTML = renderRun(r);
  } catch (e) {
    $('#output-body').innerHTML = `<span class="bad">${esc(e.message)}</span>`;
  } finally {
    S.running = false;
    btn.disabled = false;
    btn.classList.remove('running');
    btn.querySelector('span').textContent = 'Run code';
  }
}

// ---------- submit ----------

function confirmSubmit() {
  if (!S.tasks.some((t) => t.ready)) return toast('Add a question first');
  modal(
    'Submit your solutions?',
    `<p>Every task is graded against its examples and hidden tests. Remaining time: <b>${$('#timer-text').textContent}</b>.</p>`,
    [{ label: 'Cancel' }, { label: 'Submit', primary: true, onClick: () => submit(false) }]
  );
}

async function submit(timeUp) {
  if (S.submitted) return;
  flushSave();
  const solutions = S.tasks
    .filter((t) => t.ready)
    .map((t) => {
      const lang = langOf(t);
      return { id: t.id, language: lang, code: store.get(codeKey(t, lang), t.templates[lang]) };
    });
  $('#overlay-text').textContent = timeUp ? 'Time is up. Grading your solutions…' : 'Grading your solutions…';
  $('#overlay').hidden = false;
  try {
    const { results } = await api('POST', '/api/submit', { solutions });
    S.submitted = true;
    showResults(results, timeUp);
  } catch (e) {
    toast(e.message);
  } finally {
    $('#overlay').hidden = true;
  }
}

function showResults(results, timeUp) {
  const total = results.length ? Math.round(results.reduce((n, r) => n + r.score, 0) / results.length) : 0;
  const sections = results
    .map((r, i) => {
      const rows = r.cases
        .map(
          (c, k) =>
            `<div class="${c.status === 'OK' ? 'c-ok' : 'c-bad'}">${k + 1}. ${c.kind === 'example' ? 'example' : 'hidden'} ${c.input ? esc(c.input.slice(0, 80)) : ''} — ${c.status}${c.detail ? ' (' + esc(c.detail) + ')' : ''} <span class="muted">${(c.ms / 1000).toFixed(3)} s</span>${c.error ? `<div class="c-err">${esc(c.error)}</div>` : ''}</div>`
        )
        .join('');
      const compile = r.compile.ok ? '' : `<pre class="code-view">${esc(r.compile.output)}</pre>`;
      const sol = r.solution ? `<details class="fold"><summary>Show solution</summary><pre class="code-view">${esc(r.solution.code)}</pre></details>` : '';
      return `<div class="task-card"><div class="task-card-head"><h2>Task ${i + 1}: ${esc(r.title)}</h2><span class="score-pill ${r.score === 100 ? 'good' : r.score >= 50 ? 'mid' : 'low'}">${r.score}%</span><span class="muted small">${r.passed}/${r.total} tests · ${esc(r.lang)}</span></div><div class="groups"><div class="cases">${rows}</div>${compile}</div>${sol}</div>`;
    })
    .join('');
  modal(
    `${timeUp ? 'Time is up. ' : ''}Score: ${total}%`,
    sections,
    [
      { label: 'Keep working', onClick: () => (S.submitted = false) },
      { label: 'Restart timer', primary: true, onClick: restartTimer },
    ],
    true
  );
}

// ---------- timer ----------

function restartTimer() {
  const minutes = Number(new URLSearchParams(location.search).get('minutes')) || store.get('minutes', DEFAULT_MINUTES);
  S.timerEnd = Date.now() + minutes * 60000;
  store.set('timerEnd', S.timerEnd);
  S.submitted = false;
  tick();
}

function tick() {
  const left = Math.max(0, S.timerEnd - Date.now());
  const totalMin = Math.floor(left / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const s = Math.floor((left % 60000) / 1000);
  $('#timer-text').textContent = left < 120000 ? `${h}h ${m}min ${s}s` : `${h}h ${m}min`;
  $('#timer').classList.toggle('warn', left < 300000 && left >= 60000);
  $('#timer').classList.toggle('danger', left < 60000);
  if (left === 0 && !S.submitted && S.tasks.some((t) => t.ready)) submit(true);
}

// ---------- layout: splitters, collapse, output ----------

function expandOutput() {
  const body = $('#solution-body');
  const h = parseInt(getComputedStyle(body).getPropertyValue('--out-h'), 10);
  if (h < 220) body.style.setProperty('--out-h', Math.round(body.clientHeight * 0.4) + 'px');
}

function dragger(el, onMove) {
  el.addEventListener('mousedown', (e) => {
    e.preventDefault();
    el.classList.add('dragging');
    const move = (ev) => onMove(ev);
    const up = () => {
      el.classList.remove('dragging');
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
}

function setupLayout() {
  const ws = $('#workspace');
  dragger($('#gutter-task'), (e) => {
    const r = ws.getBoundingClientRect();
    const pct = Math.min(70, Math.max(18, ((e.clientX - r.left - 40) / r.width) * 100));
    ws.style.setProperty('--task-w', pct + '%');
  });
  const body = $('#solution-body');
  dragger($('#gutter-output'), (e) => {
    const r = body.getBoundingClientRect();
    body.style.setProperty('--out-h', Math.min(r.height - 140, Math.max(92, r.bottom - e.clientY)) + 'px');
  });
  $('#collapse-task').onclick = () => {
    ws.classList.add('task-collapsed');
    toast('Click a task number to show the description again');
  };
  $('#toggle-output').onclick = () => {
    const h = parseInt(getComputedStyle(body).getPropertyValue('--out-h'), 10);
    body.style.setProperty('--out-h', h > 140 ? '132px' : Math.round(body.clientHeight * 0.4) + 'px');
  };
  new ResizeObserver(() => S.editor && S.editor.layout()).observe($('.editor-wrap'));
}

// ---------- events ----------

function bindEvents() {
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-task],[data-file],[data-tab],[data-close],[data-copy],[data-action]');
    if (!el) return;
    if (el.dataset.close !== undefined) {
      e.stopPropagation();
      return closeFile(el.dataset.close);
    }
    if (el.dataset.task !== undefined) {
      $('#workspace').classList.remove('task-collapsed');
      return selectTask(Number(el.dataset.task));
    }
    if (el.dataset.file) return openFile(el.dataset.file);
    if (el.dataset.tab) return openFile(el.dataset.tab);
    if (el.dataset.copy !== undefined) {
      navigator.clipboard.writeText(el.parentElement.querySelector('span').textContent).then(() => toast('Copied'));
      return;
    }
    const a = el.dataset.action;
    if (a === 'toggle-theme') applyTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
    if (a === 'settings') openSettings();
    if (a === 'help') openHelp();
    if (a === 'leave') modal('Restart the test?', '<p>The timer starts over. Your code is kept.</p>', [{ label: 'Cancel' }, { label: 'Restart', primary: true, onClick: restartTimer }]);
    if (a === 'notes') openNotes();
  });
  $('#modal-x').onclick = closeModal;
  $('#modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') closeModal();
  });
  $('#run-btn').onclick = runCode;
  $('#submit-btn').onclick = confirmSubmit;
  $('#lang-select').onchange = (e) => setLanguage(e.target.value);
  window.addEventListener('beforeunload', flushSave);
}

function openSettings() {
  const size = store.get('fontSize', 14);
  modal(
    'Settings',
    `<div class="settings-grid">
      <label for="set-font">Editor font size</label><input id="set-font" type="number" min="10" max="24" value="${size}">
      <label for="set-min">Test length (minutes)</label><input id="set-min" type="number" min="1" max="300" value="${store.get('minutes', DEFAULT_MINUTES)}">
    </div><p class="muted small">A new test length applies the next time the timer restarts.</p>`,
    [
      { label: 'Cancel' },
      {
        label: 'Save',
        primary: true,
        onClick: () => {
          const fs = Math.min(24, Math.max(10, Number($('#set-font').value) || 14));
          store.set('fontSize', fs);
          store.set('minutes', Math.min(300, Math.max(1, Number($('#set-min').value) || DEFAULT_MINUTES)));
          if (S.editor) S.editor.updateOptions({ fontSize: fs, lineHeight: Math.round(fs * 1.45) });
        },
      },
    ]
  );
}

function openHelp() {
  modal(
    'Help',
    `<ul>
      <li><b>Run code</b> compiles your solution and runs the example tests, plus any cases you write in <b>test-input.txt</b> (one per line, e.g. <kbd>[1, 2, 3]</kbd>; add <kbd>-&gt; 4</kbd> to check the answer).</li>
      <li><b>Submit Assessment</b> grades every task against its examples and hidden tests.</li>
      <li>Your code saves automatically in this browser.</li>
      <li><kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>M</kbd> switches Tab between indenting and moving focus out of the editor.</li>
      <li>Add questions as <kbd>.md</kbd> files in <kbd>questions/</kbd> and reload. See README.md for the format.</li>
    </ul>`,
    [{ label: 'Close' }]
  );
}

function openNotes() {
  modal('Notes', `<textarea id="notes-text" placeholder="Anything to remember for next time">${esc(store.get('notes', ''))}</textarea>`, [
    { label: 'Close', onClick: () => store.set('notes', $('#notes-text') ? $('#notes-text').value : store.get('notes', '')) },
  ]);
  $('#notes-text').addEventListener('input', (e) => store.set('notes', e.target.value));
}

// ---------- boot ----------

async function boot() {
  applyTheme(store.get('theme', 'dark'));
  bindEvents();
  setupLayout();
  try {
    const data = await api('GET', '/api/tasks');
    S.tasks = data.tasks;
    S.languages = data.languages;
  } catch (e) {
    $('#task-body').innerHTML = `<p class="error-text">Can't reach the local server: ${esc(e.message)}</p>`;
  }
  renderRail();
  renderTaskPanel();
  renderLangUI();
  $('#run-btn').disabled = !S.tasks.length;

  const minutesParam = Number(new URLSearchParams(location.search).get('minutes'));
  if (minutesParam) store.set('minutes', minutesParam);
  S.timerEnd = store.get('timerEnd', 0);
  if (!S.timerEnd || S.timerEnd < Date.now() - 6 * 3600 * 1000 || minutesParam) restartTimer();
  tick();
  setInterval(tick, 1000);

  await loadMonaco();
  defineThemes();
  const fs = store.get('fontSize', 14);
  S.editor = monaco.editor.create($('#editor'), {
    theme: document.documentElement.dataset.theme === 'light' ? 'demo-light' : 'demo-dark',
    fontFamily: '"Fira Mono", ui-monospace, Menlo, monospace',
    fontSize: fs,
    lineHeight: Math.round(fs * 1.45),
    minimap: { enabled: false },
    automaticLayout: false,
    scrollBeyondLastLine: false,
    renderLineHighlight: 'line',
    lineNumbersMinChars: 3,
    glyphMargin: false,
    folding: false,
    tabSize: 4,
    insertSpaces: true,
    // like the real test: no autocomplete, hints or hovers
    quickSuggestions: false,
    suggestOnTriggerCharacters: false,
    wordBasedSuggestions: 'off',
    parameterHints: { enabled: false },
    hover: { enabled: false },
    acceptSuggestionOnEnter: 'off',
    snippetSuggestions: 'none',
    guides: { indentation: true },
    padding: { top: 8 },
  });
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true });
  $('#editor-loading').hidden = true;
  renderTabs();
}

boot();
