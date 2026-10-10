#!/usr/bin/env node
'use strict';
// Local clone of the Codility demo test page. Serves the page and runs your code.

const http = require('http');
const fs = require('fs');
const path = require('path');
const Q = require('./lib/questions');
const judge = require('./lib/judge');
const { publicToolchains } = require('./lib/runner');

const PORT = Number(process.env.PORT) || 4141;
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (d) => (data += d));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(Object.assign(new Error('invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function question(id) {
  const q = Q.get(String(id || ''));
  if (!q) throw Object.assign(new Error('question not found'), { status: 404 });
  if (!q.returns) throw Object.assign(new Error(`fix ${q.file} first: ${q.errors[0]}`), { status: 422 });
  return q;
}

const lang = (l) => (Q.LANGS.includes(l) ? l : 'java');

async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/tasks' && req.method === 'GET') {
    return send(res, 200, { tasks: Q.loadAll().map(Q.publicView), languages: publicToolchains(), folder: Q.DIR });
  }
  if (url.pathname === '/api/run' && req.method === 'POST') {
    const b = await readBody(req);
    return send(res, 200, await judge.run(question(b.id), lang(b.language), String(b.code || ''), b.testInput));
  }
  if (url.pathname === '/api/submit' && req.method === 'POST') {
    const b = await readBody(req);
    const results = [];
    for (const s of b.solutions || []) results.push(await judge.submit(question(s.id), lang(s.language), String(s.code || '')));
    return send(res, 200, { results });
  }
  let rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

http
  .createServer((req, res) =>
    handle(req, res).catch((e) => {
      if (!e.status) console.error(e);
      send(res, e.status || 500, { error: e.message });
    })
  )
  .listen(PORT, '127.0.0.1', () => {
    console.log(`Demo test clone running at http://localhost:${PORT}`);
    console.log(`Questions folder: ${Q.DIR}`);
    console.log('Languages: ' + publicToolchains().map((t) => `${t.label}${t.available ? '' : ' (missing)'}`).join(', '));
  });
