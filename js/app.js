import { parseProfile, buildSequence, totalDuration, mixingTable, PROCESS_TYPES } from './profile.js';
import { ProcessRunner } from './runner.js';
import { formatTime, formatDuration, formatTemp, parseDuration } from './format.js';
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

/** Inhalt ersetzen; false/null/undefined (aus `bedingung && element`) werden ignoriert. */
function fill(el, ...children) {
  el.replaceChildren(...children.flat().filter((c) => c != null && c !== false));
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

/** Behälter-Symbol: Kreis mit Nummer, "W" für Wasser (Kanister 0 = Spülen/Vorwässern). */
function badge(canister, extraClass = '') {
  const water = canister === 0;
  return h('span', {
    class: `badge ${water ? 'badge--water' : ''} ${extraClass}`.trim(),
    title: water ? 'Wasser' : `Behälter ${canister}`,
    'aria-label': water ? 'Wasser' : `Behälter ${canister}`,
  }, water ? 'W' : String(canister));
}

/** Re-use / One-shot – nur für Chemie, nicht für Wasser. */
function usageTag(seg, extraClass = '') {
  if (!seg || seg.kind !== 'step' || seg.canister === 0) return null;
  // Re-use hervorheben: dafür muss rechtzeitig die richtige Flasche bereitstehen; Wegschütten ist Routine.
  return h('span', { class: `usage ${seg.one_shot ? '' : 'usage--reuse'} ${extraClass}`.trim() },
    seg.one_shot ? 'One-shot' : 'Re-use');
}

// ---------------------------------------------------------------- Ansichten

const views = { list: $('view-list'), prep: $('view-prep'), steps: $('view-steps'), run: $('view-run') };
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

function profileTile(entry) {
  if (entry.error) {
    return h('div', { class: 'tile tile--error' },
      h('span', { class: 'tile__name' }, entry.file),
      h('span', { class: 'tile__meta' }, entry.error));
  }
  const p = entry.profile;
  const total = totalDuration(buildSequence(p, prefs.get(entry.file).option ?? 0));
  return h('button', { type: 'button', class: 'tile', onclick: () => openSetup(entry) },
    h('span', { class: 'tile__name' }, p.name),
    h('span', { class: 'tile__meta' }, `Temp: ${formatTemp(p.temp_c)}`),
    h('span', { class: 'tile__meta' }, `Dauer: ${formatDuration(total)}`));
}

function renderList(entries) {
  // Gruppen nach Prozesstyp; Profile ohne Typ unter "Sonstige".
  // Kaputte Dateien bleiben sichtbar (wie auf dem Gerät), als eigene Gruppe am Ende.
  const groups = [
    ...Object.entries(PROCESS_TYPES).map(([type, label]) =>
      [label, entries.filter((e) => e.profile?.process_type === type)]),
    ['Sonstige', entries.filter((e) => e.profile && !e.profile.process_type)],
    ['Fehlerhafte Dateien', entries.filter((e) => e.error)],
  ];
  fill($('profile-list'),
    groups
      .filter(([, items]) => items.length > 0)
      .map(([label, items]) =>
        h('section', { class: 'group' },
          h('h2', { class: 'group__title' }, label),
          h('div', { class: 'tiles' }, items.map(profileTile)))));
}

// ---------------------------------------------------------------- Vorbereitung
// Zwei Schritte, wie in der Praxis:
//   1. "prep":  Film/Variante + Tank wählen, Ansatz anzeigen → Chemie ansetzen
//   2. "steps": Ablauf prüfen, Zeiten anpassen (Push/Pull) → Start
// Profile ohne Auswahl und ohne Ansatz springen direkt zu 2.

let selected = null; // { file, profile, option, tank, overrides }

/** Ablauf inkl. der nur für diesen Lauf geänderten Zeiten (Push/Pull) – Profil bleibt unverändert. */
function currentSequence() {
  return buildSequence(selected.profile, selected.option).map((s, i) =>
    selected.overrides.has(i) ? { ...s, duration_s: selected.overrides.get(i), base_s: s.duration_s } : s);
}

/** Tankwahl ist in der App nur für den Ansatz relevant (Drehzahl betrifft nur die Maschine). */
const hasMixing = (p) => p.tanks.some((t) => t.volume > 0) && p.steps.some((s) => s.stock_perc !== null);
const hasPrep = (p) => p.option.length > 0 || hasMixing(p);

function openSetup(entry) {
  const saved = prefs.get(entry.file);
  const p = entry.profile;
  selected = {
    ...entry,
    option: Math.min(saved.option ?? 0, Math.max(0, p.option.length - 1)),
    tank: Math.min(saved.tank ?? 0, Math.max(0, p.tanks.length - 1)),
    overrides: new Map(), // Segment-Index → Sekunden
  };
  for (const id of ['prep-name', 'steps-name']) $(id).textContent = p.name;
  $('prep-temp').textContent = formatTemp(p.temp_c, p.temp_tolerance_c);

  if (hasPrep(p)) {
    renderPrep();
    show('prep');
  } else {
    openSteps();
  }
}

function openSteps() {
  renderSteps();
  show('steps');
}

function selectField(label, items, value, onchange) {
  return h('label', { class: 'field' }, label,
    h('select', { onchange: (e) => onchange(Number(e.target.value)) },
      items.map((item, i) => h('option', { value: i, selected: i === value }, item))));
}

function renderPrep() {
  const { profile: p } = selected;
  const update = (key) => (value) => {
    if (key === 'option') {
      // Neue Variante → deren Zeit gilt wieder; eigene Änderung an diesem Schritt verwerfen.
      buildSequence(p, selected.option).forEach((s, i) => {
        if (s.kind === 'step' && s.canister === p.option_canister) selected.overrides.delete(i);
      });
    }
    selected[key] = value;
    prefs.set(selected.file, { option: selected.option, tank: selected.tank });
    renderPrep();
  };

  fill($('prep-selects'),
    p.option.length > 0 && selectField(p.option_label, p.option.map((o) => `${o.name} – ${formatDuration(o.duration_s)}`), selected.option, update('option')),
    hasMixing(p) && selectField('Tank', p.tanks.map((t) => `${t.name}${t.volume ? ` – ${t.volume} ml` : ''}`), selected.tank, update('tank')),
  );

  const rows = mixingTable(p, selected.tank);
  fill($('prep-mixing'),
    rows.length > 0 && h('div', { class: 'mixing' },
      h('h3', {}, 'Ansatz'),
      h('table', {},
        h('thead', {}, h('tr', {}, h('th', {}, 'Schritt'), h('th', {}, 'Beh.'), h('th', { class: 'num' }, 'Stamm'), h('th', { class: 'num' }, 'Gesamt'))),
        h('tbody', {}, rows.map((r) =>
          h('tr', {},
            h('td', {}, r.name, ' ', usageTag({ kind: 'step', ...r })),
            h('td', {}, badge(r.canister)),
            h('td', { class: 'num' }, `${r.stock_ml} ml`),
            h('td', { class: 'num' }, `${r.total_ml} ml`)))))),
  );
}

function renderSteps() {
  const { profile: p } = selected;

  // Zusammenfassung der Auswahl aus Schritt 1
  const summary = [
    formatTemp(p.temp_c, p.temp_tolerance_c),
    p.option.length > 0 && p.option[selected.option].name,
    hasMixing(p) && p.tanks[selected.tank].name,
  ].filter(Boolean).join(' · ');
  $('steps-summary').textContent = summary;
  $('steps-back').textContent = hasPrep(p) ? '‹ Ansatz' : '‹ Prozesse';

  const segments = currentSequence();
  const edited = selected.overrides.size > 0;
  fill($('steps-table'),
    h('thead', {}, h('tr', {}, h('th', {}, 'Schritt'), h('th', {}, 'Beh.'), h('th', { class: 'num' }, 'Zeit'))),
    h('tbody', {}, segments.map((s, i) =>
      h('tr', { class: s.kind === 'purge' ? 'purge' : '' },
        h('td', {}, s.kind === 'purge' ? `↳ Spülen` : s.name, ' ', usageTag(s)),
        h('td', {}, badge(s.canister)),
        h('td', { class: 'num' }, timeInput(s, i))))),
    h('tfoot', {},
      h('tr', {}, h('td', { colspan: 2 }, 'Gesamt'), h('td', { class: 'num' }, formatDuration(totalDuration(segments)))),
      edited && h('tr', {}, h('td', { colspan: 3, class: 'note' },
        'Geänderte Zeiten gelten nur für diesen Lauf. ',
        h('button', { type: 'button', class: 'link', onclick: () => { selected.overrides.clear(); renderSteps(); } }, 'Alle zurücksetzen')))),
  );
}

/** Zeit-Feld in der Schrittliste: Ziffern-Tastatur, "830" = 8:30. */
function timeInput(seg, index) {
  return h('input', {
    type: 'text',
    inputmode: 'numeric',
    class: `time-input ${seg.base_s !== undefined ? 'time-input--edited' : ''}`.trim(),
    value: formatDuration(seg.duration_s),
    'aria-label': `Zeit ${seg.kind === 'purge' ? 'Spülen' : seg.name}`,
    title: seg.base_s !== undefined ? `Profil: ${formatDuration(seg.base_s)}` : 'Zeit ändern (nur für diesen Lauf)',
    onfocus: (e) => e.target.select(),
    onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
    onchange: (e) => {
      const value = parseDuration(e.target.value);
      const base = seg.base_s ?? seg.duration_s;
      if (value === null) { /* ungültig → alten Wert wieder anzeigen */ }
      else if (value === base) selected.overrides.delete(index);
      else selected.overrides.set(index, value);
      renderSteps();
    },
  });
}

$('btn-prep-ok').addEventListener('click', openSteps);
$('steps-back').addEventListener('click', () => {
  if (hasPrep(selected.profile)) { renderPrep(); show('prep'); } else show('list');
});

$('btn-run').addEventListener('click', () => {
  unlockAudio(); // muss in der Nutzergeste passieren (iOS)
  startRun(currentSequence());
});

// ---------------------------------------------------------------- Lauf

let runner = null;

function segmentLabel(seg) {
  return seg.kind === 'purge' ? `Spülen nach ${seg.after}` : seg.name;
}

function startRun(segments) {
  runner = new ProcessRunner(segments);
  $('run-name').textContent = selected.profile.name;
  delete $('run-canister').dataset.key;
  delete $('run-next').dataset.key;
  delete $('run-usage').dataset.key;
  fill($('run-progress'), ...segments.map((s) => h('li', { class: s.kind })));

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
  // Symbol nur bei Wechsel neu bauen (render läuft 10×/s)
  const canKey = done || !seg ? '' : String(seg.canister);
  if ($('run-canister').dataset.key !== canKey) {
    $('run-canister').dataset.key = canKey;
    fill($('run-canister'), canKey === '' ? '' : badge(seg.canister, 'badge--lg'));
  }
  const usageKey = done || !seg ? '' : String(runner.index);
  if ($('run-usage').dataset.key !== usageKey) {
    $('run-usage').dataset.key = usageKey;
    fill($('run-usage'), done ? '' : usageTag(seg, 'usage--lg') ?? '');
  }
  $('run-display').textContent = formatTime(runner.remaining);
  $('run-total').textContent = done ? '' : `noch ${formatTime(runner.totalRemaining)}`;

  const next = runner.next;
  const nextKey = done ? 'done' : next ? `${runner.index + 1}` : 'last';
  if ($('run-next').dataset.key !== nextKey) {
    $('run-next').dataset.key = nextKey;
    fill($('run-next'),
      ...(done ? [] : next
        ? ['Danach:', badge(next.canister), `${segmentLabel(next)} · ${formatDuration(next.duration_s)}`, usageTag(next) ?? '']
        : ['Letzter Schritt']));
  }

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
  openSteps();
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
    fill($('profile-list'),
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

