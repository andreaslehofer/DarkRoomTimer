#!/usr/bin/env node
// Build-Schritt vor jedem Commit/Deploy:
//   1. profiles/*.json prüfen (gleiche Regeln wie App und Gerät)
//   2. profiles/index.json schreiben (GitHub Pages kann keine Ordner auflisten)
//   3. CACHE_VERSION in sw.js aus dem Inhalt aller ausgelieferten Dateien berechnen,
//      damit installierte Apps jede Änderung sicher bekommen.
// Fehlerhafte Profile landen trotzdem im Index – die App zeigt sie als rote Kachel.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProfile, profileWarnings } from '../js/profile.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => join(root, p);

// 1 + 2: Profile
const files = readdirSync(rel('profiles'))
  .filter((f) => f.endsWith('.json') && f !== 'index.json')
  .sort();

let errors = 0;
for (const file of files) {
  try {
    const profile = parseProfile(JSON.parse(readFileSync(rel(`profiles/${file}`), 'utf8')));
    console.log(`✓ ${file.padEnd(18)} ${profile.name}`);
    for (const w of profileWarnings(profile)) console.log(`  ⚠ ${w}`);
  } catch (err) {
    errors++;
    console.log(`✗ ${file.padEnd(18)} ${err.message}`);
  }
}
writeFileSync(rel('profiles/index.json'), JSON.stringify({ profiles: files }, null, 2) + '\n');

// 3: Cache-Version
const swPath = rel('sw.js');
let sw = readFileSync(swPath, 'utf8');
const shell = [...sw.matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]).filter((p) => !p.includes('$'));
const hash = createHash('sha256');
for (const p of [...shell, ...files.map((f) => `profiles/${f}`)].sort()) {
  hash.update(p).update('\0').update(readFileSync(rel(p))).update('\0');
}
hash.update(sw.replace(/const CACHE_VERSION = '[^']*';/, ''));
const version = hash.digest('hex').slice(0, 10);
sw = sw.replace(/const CACHE_VERSION = '[^']*';/, `const CACHE_VERSION = '${version}';`);
writeFileSync(swPath, sw);

console.log(`\n${files.length} Profile, ${errors} fehlerhaft · CACHE_VERSION ${version}`);
process.exitCode = errors > 0 ? 1 : 0;
