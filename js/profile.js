// Prozessprofile: Validierung, Ablauf-Erzeugung, Ansatztabelle.
// Format 1:1 kompatibel mit CPPTouch (cpp2-ui/profiles/README.md) –
// gleiche Regeln, gleiche Verwerfungsgründe. Zusätzliche App-Felder
// (z. B. "option_label") ignoriert das Gerät.
// Läuft im Browser und in Node (scripts/build.mjs).

export const LIMITS = {
  maxSteps: 16,
  maxTanks: 8,
  maxOptions: 8,
  canisterMax: 7,
  tempMin: 0,
  tempMax: 60,
  rpmMin: 30,
  rpmMax: 100,
  nameBytes: 31, // Gerät: PROFILE_STORE_MAX_NAME_LEN 32 inkl. '\0', UTF-8
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const str = (v, fallback) => (typeof v === 'string' && v.trim() ? v.trim() : fallback);

class ProfileError extends Error {}
const fail = (msg) => { throw new ProfileError(msg); };

/**
 * Prüft ein eingelesenes Profil-JSON und liefert ein normalisiertes Objekt.
 * Wirft ProfileError mit deutscher Meldung, wenn die Datei verworfen werden muss.
 */
export function parseProfile(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('Kein JSON-Objekt');

  const name = str(raw.name, null);
  if (!name) fail("'name' fehlt");

  if (!isNum(raw.temp_c)) fail("'temp_c' fehlt");
  if (raw.temp_c < LIMITS.tempMin || raw.temp_c > LIMITS.tempMax) {
    fail(`temp_c=${raw.temp_c} außerhalb ${LIMITS.tempMin}..${LIMITS.tempMax}`);
  }
  const temp_tolerance_c = isNum(raw.temp_tolerance_c) ? raw.temp_tolerance_c : 0.5;

  if (!Array.isArray(raw.steps) || raw.steps.length === 0) fail("'steps' fehlt oder ist leer");
  if (raw.steps.length > LIMITS.maxSteps) fail(`Mehr als ${LIMITS.maxSteps} Schritte`);

  const steps = raw.steps.map((s, i) => {
    const n = i + 1;
    if (!s || typeof s !== 'object') fail(`Schritt ${n}: kein Objekt`);
    if (!isNum(s.canister)) fail(`Schritt ${n}: 'canister' fehlt`);
    const canister = Math.trunc(s.canister);
    if (canister < 0 || canister > LIMITS.canisterMax) {
      fail(`Schritt ${n}: canister=${canister} außerhalb 0..${LIMITS.canisterMax}`);
    }
    const duration_s = isNum(s.duration_s) ? Math.trunc(s.duration_s) : 0;
    if (duration_s < 0) fail(`Schritt ${n}: duration_s darf nicht negativ sein`);
    const purge_s = isNum(s.purge_s) ? Math.trunc(s.purge_s) : 0;
    if (purge_s < 0) fail(`Schritt ${n}: purge_s darf nicht negativ sein`);
    let stock_perc = null;
    if (s.stock_perc !== undefined) {
      if (!isNum(s.stock_perc) || s.stock_perc < 0 || s.stock_perc > 100) {
        fail(`Schritt ${n}: stock_perc außerhalb 0..100`);
      }
      stock_perc = s.stock_perc;
    }
    return { name: str(s.name, 'Schritt'), canister, duration_s, purge_s, stock_perc };
  });

  let tanks = [];
  if (raw.tanks !== undefined) {
    if (!Array.isArray(raw.tanks)) fail("'tanks' ist keine Liste");
    if (raw.tanks.length > LIMITS.maxTanks) fail(`Mehr als ${LIMITS.maxTanks} Tanks`);
    tanks = raw.tanks.map((t, i) => {
      if (!t || !isNum(t.rpm)) fail(`Tank ${i + 1}: 'rpm' fehlt`);
      if (t.rpm < LIMITS.rpmMin || t.rpm > LIMITS.rpmMax) {
        fail(`Tank ${i + 1}: rpm=${t.rpm} außerhalb ${LIMITS.rpmMin}..${LIMITS.rpmMax}`);
      }
      return { name: str(t.name, `Tank ${i + 1}`), rpm: t.rpm, volume: isNum(t.volume) ? t.volume : 0 };
    });
  }

  let option = [];
  let option_canister = null;
  if (raw.option !== undefined) {
    if (!Array.isArray(raw.option)) fail("'option' ist keine Liste");
    if (raw.option.length > LIMITS.maxOptions) fail(`Mehr als ${LIMITS.maxOptions} Optionen`);
    option = raw.option.map((o, i) => {
      if (!o || !isNum(o.duration_s) || o.duration_s <= 0) fail(`Option ${i + 1}: duration_s muss > 0 sein`);
      return { name: str(o.name, `Option ${i + 1}`), duration_s: Math.trunc(o.duration_s) };
    });
    if (option.length > 0) {
      if (!isNum(raw.option_canister)) fail("'option' ohne 'option_canister'");
      option_canister = Math.trunc(raw.option_canister);
      if (!steps.some((s) => s.canister === option_canister)) {
        fail(`Kein Schritt mit canister=${option_canister} für 'option'`);
      }
    }
  }

  steps.forEach((s, i) => {
    const overridden = option.length > 0 && s.canister === option_canister;
    if (!overridden && s.duration_s <= 0) fail(`Schritt ${i + 1} (${s.name}): duration_s muss > 0 sein`);
  });

  return {
    name,
    temp_c: raw.temp_c,
    temp_tolerance_c,
    steps,
    tanks,
    option,
    option_canister,
    option_label: str(raw.option_label, 'Variante'),
  };
}

/** Hinweise, die das Profil nicht ungültig machen (z. B. Kürzung auf dem Gerät). */
export function profileWarnings(profile) {
  const bytes = (s) => new TextEncoder().encode(s).length;
  const names = [
    ['Profil', profile.name],
    ...profile.steps.map((s, i) => [`Schritt ${i + 1}`, s.name]),
    ...profile.tanks.map((t, i) => [`Tank ${i + 1}`, t.name]),
    ...profile.option.map((o, i) => [`Option ${i + 1}`, o.name]),
  ];
  return names
    .filter(([, n]) => bytes(n) > LIMITS.nameBytes)
    .map(([what, n]) => `${what} „${n}“ ist ${bytes(n)} Byte lang – wird auf dem Gerät auf ${LIMITS.nameBytes} gekürzt`);
}

/**
 * Erzeugt die lineare Abfolge der Timer-Segmente für einen Lauf:
 * jeder Schritt, gefolgt von einem Spül-Segment, falls purge_s > 0.
 */
export function buildSequence(profile, optionIndex = 0) {
  const opt = profile.option[optionIndex] ?? profile.option[0];
  const segments = [];
  for (const step of profile.steps) {
    const overridden = opt && step.canister === profile.option_canister;
    segments.push({
      kind: 'step',
      name: step.name,
      canister: step.canister,
      duration_s: overridden ? opt.duration_s : step.duration_s,
    });
    if (step.purge_s > 0) {
      segments.push({ kind: 'purge', name: 'Spülen', canister: 0, duration_s: step.purge_s, after: step.name });
    }
  }
  return segments;
}

export const totalDuration = (segments) => segments.reduce((sum, s) => sum + s.duration_s, 0);

/** Zeilen der Ansatztabelle: nur Schritte mit stock_perc, nur mit gewähltem Tank. */
export function mixingTable(profile, tankIndex = 0) {
  const tank = profile.tanks[tankIndex];
  if (!tank || !tank.volume) return [];
  return profile.steps
    .filter((s) => s.stock_perc !== null)
    .map((s) => ({
      name: s.name,
      canister: s.canister,
      stock_ml: Math.round((tank.volume * s.stock_perc) / 100),
      total_ml: tank.volume,
    }));
}
