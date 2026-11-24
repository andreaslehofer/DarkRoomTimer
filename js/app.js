import { parseProfile, buildSequence, totalDuration, mixingTable } from './profile.js';
import { ProcessRunner } from './runner.js';
import { formatTime, formatDuration, formatTemp } from './format.js';
import { unlockAudio, signal, initWakeLock } from './alerts.js';

const $ = (id) => document.getElementById(id);

/** Kleiner DOM-Helfer – Texte immer als textContent, nie als HTML (Profile sind Fremddaten). */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

// Gemerkte Auswahl pro Profil (nur Komfort – darf fehlschlagen).
const prefs = {
  get(file) {
    try { return JSON.parse(localStorage.getItem(`drt:${file}`)) ?? {}; } catch { return {}; }
  },
  set(file, value) {
    try { localStorage.setItem(`drt:${file}`, JSON.stringify(value)); } catch { /* egal */ }
  },
};

// ---------------------------------------------------------------- Ansichten

const views = { list: $('view-list'), setup: $('view-setup'), run: $('view-run') };
function show(name) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name;
  window.scrollTo(0, 0);
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-action="back"]')) show('list');
});

// ---------------------------------------------------------------- Übersicht

async function loadProfiles() {
  const res = await fetch('profiles/index.json');
  if (!res.ok) throw new Error(`profiles/index.json: HTTP ${res.status}`);
  const { profiles: files } = await res.json();

  return Promise.all(
    files.map(async (file) => {
      try {
        const r = await fetch(`profiles/${file}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        let raw;
        try { raw = await r.json(); } catch { throw new Error('Kein gültiges JSON'); }
        return { file, profile: parseProfile(raw) };
      } catch (err) {
        return { file, error: err.message };
      }
    })
  );
}

function renderList(entries) {
  // Gültige Profile zuerst, kaputte Dateien bleiben sichtbar (wie auf dem Gerät).
  const sorted = [...entries].sort((a, b) => !!a.error - !!b.error);
  $('profile-list').replaceChildren(
    ...sorted.map((entry) => {
      if (entry.error) {
        return h('div', { class: 'tile tile--error' },
          h('span', { class: 'tile__name' }, entry.file),
          h('span', { class: 'tile__meta' }, entry.error));
      }
      const p = entry.profile;
      const total = totalDuration(buildSequence(p, prefs.get(entry.file).option ?? 0));
      return h('button', { type: 'button', class: 'tile', onclick: () => openSetup(entry) },
        h('span', { class: 'tile__name' }, p.name),
        h('span', { class: 'tile__meta' }, `${formatTemp(p.temp_c, p.temp_tolerance_c)}`),
        h('span', { class: 'tile__meta' }, `${p.steps.length} Schritte · ${formatDuration(total)}`));
    })
  );
}

// ---------------------------------------------------------------- Vorbereitung

let selected = null; // { file, profile, option, tank }

function openSetup(entry) {
  const saved = prefs.get(entry.file);
  const p = entry.profile;
  selected = {
    ...entry,
    option: Math.min(saved.option ?? 0, Math.max(0, p.option.length - 1)),
    tank: Math.min(saved.tank ?? 0, Math.max(0, p.tanks.length - 1)),
  };
  $('setup-name').textContent = p.name;
  $('setup-temp').textContent = formatTemp(p.temp_c, p.temp_tolerance_c);
  renderSetup();
  show('setup');
}

function selectField(label, items, value, onchange) {
  return h('label', { class: 'field' }, label,
    h('select', { onchange: (e) => onchange(Number(e.target.value)) },
      items.map((item, i) => h('option', { value: i, selected: i === value }, item))));
}

function renderSetup() {
  const { profile: p } = selected;
  const update = (key) => (value) => {
    selected[key] = value;
    prefs.set(selected.file, { option: selected.option, tank: selected.tank });
    renderSetup();
  };

  $('setup-selects').replaceChildren(
    p.option.length > 0 && selectField(p.option_label, p.option.map((o) => `${o.name} – ${formatDuration(o.duration_s)}`), selected.option, update('option')),
    p.tanks.length > 0 && selectField('Tank', p.tanks.map((t) => t.name), selected.tank, update('tank')),
  );

  const segments = buildSequence(p, selected.option);
  $('setup-steps').replaceChildren(
    h('thead', {}, h('tr', {}, h('th', {}, 'Schritt'), h('th', {}, 'Beh.'), h('th', { class: 'num' }, 'Zeit'))),
    h('tbody', {}, segments.map((s) =>
      h('tr', { class: s.kind === 'purge' ? 'purge' : '' },
        h('td', {}, s.kind === 'purge' ? `↳ Spülen` : s.name),
        h('td', {}, String(s.canister)),
        h('td', { class: 'num' }, formatDuration(s.duration_s))))),
    h('tfoot', {}, h('tr', {}, h('td', { colspan: 2 }, 'Gesamt'), h('td', { class: 'num' }, formatDuration(totalDuration(segments))))),
  );

  const rows = mixingTable(p, selected.tank);
  $('setup-mixing').replaceChildren(
    rows.length > 0 && h('div', { class: 'mixing' },
      h('h3', {}, 'Ansatz'),
      h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Schritt'), h('th', {}, 'Beh.'), h('th', { class: 'num' }, 'Stamm'), h('th', { class: 'num' }, 'Gesamt'))),
        h('tbody', {}, rows.map((r) =>
          h('tr', {},
            h('td', {}, r.name),
            h('td', {}, String(r.canister)),
            h('td', { class: 'num' }, `${r.stock_ml} ml`),
            h('td', { class: 'num' }, `${r.total_ml} ml`)))))),
  );
}

$('btn-run').addEventListener('click', () => {
  unlockAudio(); // muss in der Nutzergeste passieren (iOS)
  startRun(buildSequence(selected.profile, selected.option));
});

// ---------------------------------------------------------------- Lauf

let runner = null;

function segmentLabel(seg) {
  return seg.kind === 'purge' ? `Spülen nach ${seg.after}` : seg.name;
}

function startRun(segments) {
  runner = new ProcessRunner(segments);
  $('run-name').textContent = selected.profile.name;
  $('run-progress').replaceChildren(...segments.map((s) => h('li', { class: s.kind })));

  runner.addEventListener('segment', (e) => {
    if (e.detail.reason !== 'skip') signal('next');
    renderRun();
  });
  runner.addEventListener('drain', () => { signal('drain'); renderRun(); });
  runner.addEventListener('tick', renderRun);
  runner.addEventListener('state', renderRun);
  runner.addEventListener('done', () => { signal('done'); renderRun(); });

  show('run');
  runner.start();
}

function renderRun() {
  if (!runner) return;
  const seg = runner.current;
  const done = runner.state === 'done';
  const view = views.run;

  view.classList.toggle('run--draining', runner.draining);
  view.classList.toggle('run--paused', runner.state === 'paused');
  view.classList.toggle('run--done', done);

  let status = 'Läuft';
  if (done) status = 'Fertig';
  else if (runner.state === 'paused') status = 'Pausiert';
  else if (runner.draining) status = 'Ausleeren!';
  $('run-status').textContent = status;

  $('run-step').textContent = done ? selected.profile.name : segmentLabel(seg);
  $('run-canister').textContent = done || !seg ? '' : `Behälter ${seg.canister}`;
  $('run-display').textContent = formatTime(runner.remaining);
  $('run-total').textContent = done ? '' : `noch ${formatTime(runner.totalRemaining)}`;

  const next = runner.next;
  $('run-next').textContent = done
    ? ''
    : next
      ? `Danach: ${segmentLabel(next)} · Beh. ${next.canister} · ${formatDuration(next.duration_s)}`
      : 'Letzter Schritt';

  [...$('run-progress').children].forEach((li, i) => {
    li.classList.toggle('done', done || i < runner.index);
    li.classList.toggle('current', !done && i === runner.index);
  });

  $('btn-pause').textContent = done ? 'Zur Übersicht' : runner.state === 'paused' ? 'Fortsetzen' : 'Pause';
  $('btn-skip').hidden = done;
  $('btn-stop').hidden = done;
}

$('btn-pause').addEventListener('click', () => {
  if (runner.state === 'done') return endRun();
  runner.state === 'paused' ? runner.resume() : runner.pause();
});
$('btn-skip').addEventListener('click', () => runner.skip());

// Abbrechen nur mit zweitem Tipp – ein versehentlicher Tipp mit nassen Fingern darf den Lauf nicht beenden.
let stopArmed = null;
$('btn-stop').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  if (stopArmed) {
    clearTimeout(stopArmed);
    stopArmed = null;
    btn.textContent = 'Abbrechen';
    btn.classList.remove('btn--confirm');
    return endRun();
  }
  btn.textContent = 'Sicher?';
  btn.classList.add('btn--confirm');
  stopArmed = setTimeout(() => {
    stopArmed = null;
    btn.textContent = 'Abbrechen';
    btn.classList.remove('btn--confirm');
  }, 3000);
});

function endRun() {
  runner?.stop();
  runner = null;
  views.run.classList.remove('run--draining', 'run--paused', 'run--done');
  show('setup');
}

// Nach Rückkehr aus dem Hintergrund sofort nachrechnen statt auf den nächsten Tick zu warten.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') runner?.tick();
});

// ---------------------------------------------------------------- Start

initWakeLock((active) => {
  $('wake-indicator').hidden = !active;
});

loadProfiles()
  .then(renderList)
  .catch((err) => {
    $('profile-list').replaceChildren(
      h('div', { class: 'tile tile--error' },
        h('span', { class: 'tile__name' }, 'Profile nicht geladen'),
        h('span', { class: 'tile__meta' }, err.message)));
  });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => {
      console.error('Service Worker Registrierung fehlgeschlagen:', err);
    });
  });
}

