#!/usr/bin/env node
// Entwicklung: baut bei jeder gespeicherten Änderung automatisch neu (scripts/build.mjs).
//   npm run dev    → Watch + lokaler Server auf http://localhost:8080
//   npm run watch  → nur Watch (Server läuft woanders)
// Nach einer Änderung im Browser zweimal neu laden (Service Worker holt erst die neue Version).

import { watch, createReadStream, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { join, dirname, extname, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const serve = !process.argv.includes('--no-serve');
const PORT = Number(process.env.PORT) || 8080;

// --- Build mit Entprellung (Editoren speichern oft mehrfach kurz hintereinander)
let timer = null;
let running = false;
let pending = false;

function build(reason) {
  if (running) { pending = true; return; }
  running = true;
  const time = new Date().toLocaleTimeString('de-DE');
  console.log(`\n── ${time} · ${reason}`);
  const child = spawn(process.execPath, [join(root, 'scripts/build.mjs')], { cwd: root, stdio: 'inherit' });
  child.on('exit', () => {
    running = false;
    if (pending) { pending = false; build('weitere Änderungen'); }
  });
}

// Vom Build selbst geschriebene Dateien ignorieren – sonst Endlosschleife.
const IGNORE = new Set(['sw.js', join('profiles', 'index.json')]);
const WATCH = ['profiles', 'js', 'css', 'icons', 'index.html', 'manifest.webmanifest'];

for (const entry of WATCH) {
  const full = join(root, entry);
  const isDir = statSync(full).isDirectory();
  watch(full, { recursive: isDir }, (_event, file) => {
    const rel = isDir ? join(entry, file ?? '') : entry;
    if (IGNORE.has(rel) || rel.split(sep).some((part) => part.startsWith('.'))) return;
    clearTimeout(timer);
    timer = setTimeout(() => build(`geändert: ${rel}`), 200);
  });
}

build('Start');
console.log(`Beobachte: ${WATCH.join(', ')}`);

// --- Minimaler statischer Server ohne Caching
if (serve) {
  const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
  };

  createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    let stat;
    try { stat = statSync(file); } catch { res.writeHead(404).end('Nicht gefunden'); return; }
    if (!stat.isFile()) { res.writeHead(404).end('Nicht gefunden'); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    createReadStream(file).pipe(res);
  }).listen(PORT, () => console.log(`Server: http://localhost:${PORT}`));
}
