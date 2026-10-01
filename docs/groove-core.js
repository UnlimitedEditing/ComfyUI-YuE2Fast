/* YuE2 Groove Box — shared core: project model, music tables, ABC export, score checks, storage, sequencer.
   Used by stage.html (instrument stage) and groovebox.html (score editor). Plain script, exposes window.Groove. */
(function () {
"use strict";
const uid = () => Math.random().toString(36).slice(2, 9);
const clone = o => JSON.parse(JSON.stringify(o));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// ---------- music tables ----------
const LETTERS = "CDEFGAB", NATURAL = [0, 2, 4, 5, 7, 9, 11];
const KEYS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const MINOR_KEYS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"];
const FIFTHS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, "F#": 6, "C#": 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
const SHARP_ORDER = "FCGDAEB", FLAT_ORDER = "BEADGCF";
const ACC_TEXT = { 2: "^^", 1: "^", 0: "=", "-1": "_", "-2": "__" };
const SCALES = {
  major:      { label: "Major (happy)",           steps: [0, 2, 4, 5, 7, 9, 11], minor: false },
  minor:      { label: "Minor (moody)",           steps: [0, 2, 3, 5, 7, 8, 10], minor: true },
  pentatonic: { label: "Pentatonic (can't miss)", steps: [0, 2, 4, 7, 9], minor: false, parent: "major" },
  minorpent:  { label: "Minor pentatonic",        steps: [0, 3, 5, 7, 10], minor: true, parent: "minor" },
  blues:      { label: "Blues",                   steps: [0, 3, 5, 6, 7, 10], minor: true, parent: "minor" },
  dorian:     { label: "Dorian (afro-funk)",      steps: [0, 2, 3, 5, 7, 9, 10], minor: true },
  mixolydian: { label: "Mixolydian (highlife)",   steps: [0, 2, 4, 5, 7, 9, 10], minor: false },
};
// Drum lanes: id, label, colour, General MIDI key, ABC percussion-staff pitch (+ notehead) for the standard export.
const DRUMS = [
  { id: "kick",   label: "Kick",      color: "#d9534f", gm: 36, perc: "F" },
  { id: "snare",  label: "Snare",     color: "#e3842a", gm: 38, perc: "c" },
  { id: "rim",    label: "Rim",       color: "#c76b3a", gm: 37, perc: "d", head: "x" },
  { id: "clap",   label: "Clap",      color: "#c9a227", gm: 39, perc: "e", head: "triangle" },
  { id: "hat",    label: "Hi-hat",    color: "#2a9d8f", gm: 42, perc: "g", head: "x" },
  { id: "ohat",   label: "Open hat",  color: "#3a86c8", gm: 46, perc: "a", head: "x" },
  { id: "tom",    label: "Tom",       color: "#8e5bd9", gm: 45, perc: "A" },
  { id: "lowtom", label: "Low tom",   color: "#6d48b5", gm: 41, perc: "G" },
  { id: "shaker", label: "Shaker",    color: "#7a9a3a", gm: 70, perc: "b", head: "x" },
  { id: "crash",  label: "Crash",     color: "#b58b2a", gm: 49, perc: "f", head: "x" },
];
const DRUM_BY_ID = Object.fromEntries(DRUMS.map(d => [d.id, d]));
const SECTION_TYPES = ["intro", "verse", "prechorus", "chorus", "postchorus", "bridge", "interlude", "solo", "breakdown", "outro"];

// Sounds available on the stage (presets in groovebox-gm.sf3, a subset of FluidR3Mono_GM). role = where its notes land.
const SOUNDS = [
  { id: "oohs",    name: "Voice (oohs)",     program: 53,  role: "voice" },
  { id: "choir",   name: "Choir",            program: 52,  role: "voice" },
  { id: "fbass",   name: "Finger bass",      program: 33,  role: "bass" },
  { id: "sbass",   name: "Synth bass",       program: 38,  role: "bass" },
  { id: "kit",     name: "Drum kit",         program: 0,   role: "drums", drumkit: true },
  { id: "kit808",  name: "808 drum machine", program: 25,  role: "drums", drumkit: true },
  { id: "epiano",  name: "Electric piano",   program: 4,   role: "layer" },
  { id: "kalimba", name: "Kalimba",          program: 108, role: "layer" },
  { id: "marimba", name: "Marimba",          program: 12,  role: "layer" },
  { id: "vibes",   name: "Vibraphone",       program: 11,  role: "layer" },
  { id: "steel",   name: "Steel drums",      program: 114, role: "layer" },
  { id: "harp",    name: "Harp",             program: 46,  role: "layer" },
  { id: "koto",    name: "Koto",             program: 107, role: "layer" },
  { id: "guitar",  name: "Nylon guitar",     program: 24,  role: "layer" },
  { id: "flute",   name: "Flute",            program: 73,  role: "layer" },
  { id: "sax",     name: "Alto sax",         program: 65,  role: "layer" },
  { id: "trumpet", name: "Trumpet",          program: 56,  role: "layer" },
  { id: "strings", name: "Strings",          program: 48,  role: "layer" },
  { id: "pad",     name: "Dream pad",        program: 88,  role: "layer" },
  { id: "square",  name: "Square lead",      program: 80,  role: "layer" },
  { id: "saw",     name: "Saw lead",         program: 81,  role: "layer" },
  { id: "agogo",   name: "Agogo bells",      program: 113, role: "layer" },
  { id: "wood",    name: "Woodblock",        program: 115, role: "layer" },
  { id: "taiko",   name: "Taiko",            program: 116, role: "layer" },
];
const SOUND_BY_ID = Object.fromEntries(SOUNDS.map(s => [s.id, s]));
// Controllers (input widgets) and which roles they can drive. The stage implements them.
const CONTROLLERS = [
  { id: "keys",    name: "Keys",        blurb: "Big scale keys. Hold for longer notes.",            roles: ["voice", "bass", "layer"] },
  { id: "pads",    name: "Pads",        blurb: "A 4×4 pad bank, drum-machine style.",               roles: ["voice", "bass", "layer", "drums"] },
  { id: "kit",     name: "Drum kit",    blurb: "A drawn kit on stage. Tap the pieces.",              roles: ["drums"] },
  { id: "strings", name: "Strings",     blurb: "Pluck or strum across the strings.",                 roles: ["voice", "bass", "layer"] },
  { id: "xy",      name: "Slide pad",   blurb: "Glide a finger: left-right is pitch, up is louder.", roles: ["voice", "bass", "layer"] },
  { id: "bubbles", name: "Bubbles",     blurb: "Drifting notes. Pop them.",                          roles: ["voice", "layer"] },
  { id: "chords",  name: "Chord pads",  blurb: "One tap plays a whole chord and sets the bar.",      roles: ["chords"] },
];
const ROLE_LABEL = { voice: "Voice (the sung line)", bass: "Bass line", drums: "Drums", chords: "Chords", layer: "Extra layer" };

// ---------- project model ----------
// pattern.drums[lane] = absolute step indexes (bar * stepsPerBar + step)
// pattern.melody = [{step, len, row}]: the vocal line, row = scale degree index (0 = low tonic), monophonic
// pattern.layers[instrumentId or "bass"] = [{step, len, midi}]: bass and extra instruments played on the stage
// pattern.chords[bar] = degree 0..6 of the parent scale, or -1
function newPattern(name, bars) {
  bars = bars || 1;
  return { id: uid(), name, bars, drums: Object.fromEntries(DRUMS.map(d => [d.id, []])), melody: [], layers: {}, chords: Array(bars).fill(-1) };
}
function defaultDeck() {
  return [
    { id: "voice",   name: "Voice",   sound: "oohs",    controller: "keys",    role: "voice",  octave: 0,  color: "#f3a63b" },
    { id: "drums",   name: "Drums",   sound: "kit",     controller: "kit",     role: "drums",  octave: 0,  color: "#e2574c" },
    { id: "bass",    name: "Bass",    sound: "fbass",   controller: "strings", role: "bass",   octave: -2, color: "#3fa7d6" },
    { id: "chords",  name: "Chords",  sound: "epiano",  controller: "chords",  role: "chords", octave: 0,  color: "#9b6bde" },
    { id: "kalimba", name: "Kalimba", sound: "kalimba", controller: "bubbles", role: "layer",  octave: 1,  color: "#5cc98a" },
  ];
}
function demoProject() {
  const a = newPattern("Groove A", 4), spb = 16;
  const bar = (b, steps) => steps.map(s => b * spb + s), all = steps => [].concat(...[0, 1, 2, 3].map(b => bar(b, steps)));
  a.drums.kick = all([0, 6, 10]); a.drums.clap = all([4, 12]); a.drums.hat = all([0, 2, 4, 6, 8, 10, 12]); a.drums.ohat = all([14]);
  a.drums.shaker = all([1, 3, 5, 7, 9, 11, 13, 15]); a.drums.tom = bar(3, [13, 15]);
  a.chords = [0, 5, 3, 4];
  a.melody = [
    { step: 0, row: 2, len: 2 }, { step: 2, row: 4, len: 2 }, { step: 4, row: 2, len: 4 }, { step: 10, row: 0, len: 4 },
    { step: 16, row: 2, len: 2 }, { step: 18, row: 4, len: 2 }, { step: 20, row: 5, len: 4 }, { step: 26, row: 4, len: 2 }, { step: 28, row: 2, len: 2 },
    { step: 32, row: 3, len: 2 }, { step: 34, row: 2, len: 2 }, { step: 36, row: 0, len: 4 }, { step: 42, row: 1, len: 4 },
    { step: 48, row: 1, len: 2 }, { step: 50, row: 2, len: 2 }, { step: 52, row: 3, len: 4 }, { step: 58, row: 2, len: 6 },
  ];
  a.layers.kalimba = [[0, 76], [3, 79], [6, 81], [8, 76], [11, 79], [14, 84], [16, 81], [19, 79], [22, 76], [24, 81], [27, 79], [30, 76],
    [32, 77], [35, 81], [38, 84], [40, 77], [43, 81], [46, 86], [48, 79], [51, 83], [54, 86], [56, 79], [59, 83], [62, 88]].map(([step, midi]) => ({ step, len: 2, midi }));
  const b = clone(a); b.id = uid(); b.name = "Groove B"; b.chords = [5, 3, 0, 4];
  b.drums.snare = all([4, 12]); b.drums.clap = all([12]); b.drums.rim = all([3, 7, 11]);
  b.melody = b.melody.map(n => ({ ...n, row: Math.min(14, n.row + 2) }));
  return { version: 2, name: "Demo groove", title: "Groove Box sketch", bpm: 104, swing: 20, meter: "4/4", grid: 16, key: "C", scale: "major",
           octave: 0, timbre: "keys", deck: defaultDeck(), patterns: [a, b],
           song: [{ pattern: a.id, repeat: 1, section: "intro" }, { pattern: a.id, repeat: 2, section: "verse" }, { pattern: b.id, repeat: 2, section: "chorus" }] };
}
function blankProject() {
  const a = newPattern("Loop 1", 2);
  return { ...demoProject(), name: "New groove", patterns: [a], song: [{ pattern: a.id, repeat: 2, section: "verse" }] };
}
function normalizeProject(p) {
  p = clone(p);
  if (!p.patterns || !p.patterns.length) p.patterns = [newPattern("Loop 1")];
  for (const q of p.patterns) {
    q.drums = q.drums || {}; for (const d of DRUMS) q.drums[d.id] = q.drums[d.id] || [];
    q.chords = Array.from({ length: q.bars }, (_, i) => (q.chords && q.chords[i] != null) ? q.chords[i] : -1);
    q.melody = q.melody || []; q.layers = q.layers || {};
  }
  p.song = (p.song || []).filter(s => p.patterns.some(q => q.id === s.pattern));
  if (!p.song.length) p.song = [{ pattern: p.patterns[0].id, repeat: 1, section: "verse" }];
  if (!SCALES[p.scale]) p.scale = "major"; if (!KEYS.includes(p.key)) p.key = "C";
  p.grid = p.grid === 8 ? 8 : 16; p.meter = p.meter === "3/4" ? "3/4" : "4/4";
  p.bpm = clamp(+p.bpm || 100, 60, 180); p.swing = clamp(+p.swing || 0, 0, 60); p.octave = clamp(+p.octave || 0, -1, 1);
  if (!Array.isArray(p.deck) || !p.deck.length) p.deck = defaultDeck();
  p.deck = p.deck.filter(i => SOUND_BY_ID[i.sound] && CONTROLLERS.some(c => c.id === i.controller)).map(i => ({ octave: 0, color: "#888", ...i, role: SOUND_BY_ID[i.sound].role }));
  if (!p.deck.length) p.deck = defaultDeck();
  p.version = 2;
  return p;
}

// ---------- music helpers (bound to a project) ----------
function beats(P) { return +P.meter.split("/")[0]; }
function spb(P) { return beats(P) * P.grid / 4; }
function scaleDef(P) { return SCALES[P.scale]; }
function nRows(P) { return scaleDef(P).steps.length * 2 + 1; }
function tonicPc(P) { return KEYS.indexOf(P.key); }
function midiOfRow(P, row) {
  const s = scaleDef(P).steps, n = s.length, pc = tonicPc(P);
  const base = (pc >= 7 ? 48 : 60) + pc + 12 * P.octave;
  return base + 12 * Math.floor(row / n) + s[((row % n) + n) % n];
}
function rowOfMidi(P, midi) {   // nearest scale row for a pitch (exact when the pitch is in the scale)
  const n = nRows(P); let best = 0, dist = 1e9;
  for (let r = 0; r < n; r++) { const d = Math.abs(midiOfRow(P, r) - midi); if (d < dist) { dist = d; best = r; } }
  return best;
}
function pitchClass(name) { return (NATURAL[LETTERS.indexOf(name[0])] + (name[1] === "#" ? 1 : name[1] === "b" ? -1 : 0) + 12) % 12; }
function relMajor(minorTonic) {
  const li = (LETTERS.indexOf(minorTonic[0]) + 2) % 7, pc = pitchClass(minorTonic);
  const alt = (((pc + 3) % 12 - NATURAL[li]) % 12 + 18) % 12 - 6;
  return LETTERS[li] + (alt === 1 ? "#" : alt === -1 ? "b" : "");
}
function keyInfo(P) {
  const minor = scaleDef(P).minor, pc = tonicPc(P), tonic = minor ? MINOR_KEYS[pc] : KEYS[pc];
  const f = FIFTHS[minor ? relMajor(tonic) : tonic] || 0, sig = {};
  for (let i = 0; i < Math.abs(f); i++) sig[(f > 0 ? SHARP_ORDER : FLAT_ORDER)[i]] = f > 0 ? 1 : -1;
  return { tonic, minor, field: tonic + (minor ? "m" : ""), sig, f };
}
function spell(midi, sig, f) {   // letter + alteration for a pitch, preferring the key's own spellings
  const pc = ((midi % 12) + 12) % 12; let best = null;
  for (let li = 0; li < 7; li++) {
    let alt = pc - NATURAL[li]; if (alt > 6) alt -= 12; if (alt < -6) alt += 12;
    if (Math.abs(alt) > 1) continue;
    const score = (sig[LETTERS[li]] || 0) === alt ? 0 : alt === 0 ? 1 : (f < 0 ? alt < 0 : alt > 0) ? 2 : 3;
    if (!best || score < best.score) best = { li, alt, score };
  }
  return { letter: LETTERS[best.li], alt: best.alt, octave: Math.floor((midi - best.alt) / 12) - 1 };
}
const NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"], NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
function noteName(P, midi) { return (keyInfo(P).f < 0 ? NAMES_FLAT : NAMES_SHARP)[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1); }
function rowName(P, row) { return noteName(P, midiOfRow(P, row)); }
const SOLFEGE = ["do", "re", "mi", "fa", "so", "la", "ti"];
function parentSteps(P) { const d = scaleDef(P); return (d.parent ? SCALES[d.parent] : d).steps; }
function chordInfo(P, degree) {
  if (degree == null || degree < 0) return null;
  const ps = parentSteps(P), pc = tonicPc(P), k = keyInfo(P);
  const at = i => ps[i % 7] + 12 * Math.floor(i / 7);
  const root = at(degree), third = at(degree + 2) - root, fifth = at(degree + 4) - root;
  const quality = third === 4 && fifth === 7 ? "" : third === 3 && fifth === 7 ? "m" : third === 3 && fifth === 6 ? "dim" : third === 4 && fifth === 8 ? "aug" : "";
  const rootPc = (pc + root) % 12, sp = spell(60 + rootPc, k.sig, k.f);
  const rootName = sp.letter + (sp.alt === 1 ? "#" : sp.alt === -1 ? "b" : "");
  const numerals = ["I", "II", "III", "IV", "V", "VI", "VII"];
  const numeral = quality === "m" || quality === "dim" ? numerals[degree].toLowerCase() + (quality === "dim" ? "°" : "") : numerals[degree] + (quality === "aug" ? "+" : "");
  const r = 60 + rootPc - (rootPc > 6 ? 12 : 0);
  return { degree, symbol: rootName + quality, numeral, bassRoot: 36 + rootPc, bassFifth: 36 + ((rootPc + fifth) % 12), voicing: [r, r + third, r + fifth], rootPc };
}
function barChord(P, p, bar) { return chordInfo(P, p.chords[bar] != null ? p.chords[bar] : -1); }
// Bass for a bar: what the player recorded on a bass instrument, else root on kicks and fifth on snares over the bar's chord.
function bassEvents(P, p, bar) {
  const n = spb(P), base = bar * n;
  const played = (p.layers && p.layers.bass || []).filter(x => x.step >= base && x.step < base + n).sort((a, b) => a.step - b.step);
  if (played.length) {
    const out = []; let cursor = 0;
    for (const x of played) { const s = x.step - base; if (s < cursor) continue; out.push({ step: s, midi: x.midi, len: Math.min(x.len, n - s) }); cursor = s + out[out.length - 1].len; }
    return out;
  }
  const ch = barChord(P, p, bar) || chordInfo(P, 0);
  const kicks = new Set(p.drums.kick.filter(s => s >= base && s < base + n).map(s => s - base));
  const snares = new Set(p.drums.snare.filter(s => s >= base && s < base + n).map(s => s - base));
  const steps = [...new Set([...kicks, ...snares])].sort((a, b) => a - b);
  if (!steps.length) return barChord(P, p, bar) ? [{ step: 0, midi: ch.bassRoot, len: n }] : [];
  return steps.map((s, i) => ({ step: s, midi: kicks.has(s) ? ch.bassRoot : ch.bassFifth, len: (i + 1 < steps.length ? steps[i + 1] : n) - s }));
}

// ---------- editing ----------
function toggleDrum(p, lane, abs, force) {
  const arr = p.drums[lane], i = arr.indexOf(abs), on = force === undefined ? i < 0 : force;
  if (on && i < 0) arr.push(abs); if (!on && i >= 0) arr.splice(i, 1);
  arr.sort((a, b) => a - b); return on;
}
function addDrumHit(p, lane, abs) { if (!p.drums[lane].includes(abs)) { p.drums[lane].push(abs); p.drums[lane].sort((a, b) => a - b); return true; } return false; }
function addMelodyNote(P, p, abs, row, len) {   // monophonic: replaces anything it overlaps
  const n = spb(P), end = Math.min(abs + len, (Math.floor(abs / n) + 1) * n);
  p.melody = p.melody.filter(x => !(x.step < end && x.step + x.len > abs));
  p.melody.push({ step: abs, row, len: end - abs }); p.melody.sort((a, b) => a.step - b.step);
}
function noteAt(p, abs) { return p.melody.find(x => x.step <= abs && abs < x.step + x.len); }
function addLayerNote(P, p, layer, abs, midi, len, mono) {
  const n = spb(P), end = Math.min(abs + len, (Math.floor(abs / n) + 1) * n);
  const arr = p.layers[layer] = p.layers[layer] || [];
  if (mono) p.layers[layer] = p.layers[layer].filter(x => !(x.step < end && x.step + x.len > abs));
  else p.layers[layer] = p.layers[layer].filter(x => !(x.step === abs && x.midi === midi));
  p.layers[layer].push({ step: abs, midi, len: end - abs }); p.layers[layer].sort((a, b) => a.step - b.step || a.midi - b.midi);
  return arr;
}
function setBars(P, p, bars) {
  const n = spb(P), max = bars * n;
  p.bars = bars; for (const d of DRUMS) p.drums[d.id] = p.drums[d.id].filter(s => s < max);
  p.melody = p.melody.filter(x => x.step < max);
  for (const k of Object.keys(p.layers)) p.layers[k] = p.layers[k].filter(x => x.step < max);
  p.chords = Array.from({ length: bars }, (_, i) => p.chords[i] != null ? p.chords[i] : -1);
}
function remapSteps(P, oldSpb, newSpb, ratio) {   // keep the groove's shape across grid/meter changes
  for (const p of P.patterns) {
    const map = s => { const b = Math.floor(s / oldSpb), w = Math.round((s % oldSpb) * ratio); return w < newSpb ? b * newSpb + w : -1; };
    for (const d of DRUMS) p.drums[d.id] = [...new Set(p.drums[d.id].map(map).filter(s => s >= 0))].sort((a, b) => a - b);
    const fix = list => { const out = []; for (const x of list) { const s = map(x.step); if (s < 0) continue; out.push({ ...x, step: s, len: clamp(Math.round(x.len * ratio), 1, newSpb - s % newSpb) }); } return out; };
    const notes = fix(p.melody);
    p.melody = notes.filter((x, i) => !notes.some((y, j) => j < i && y.step < x.step + x.len && y.step + y.len > x.step));
    for (const k of Object.keys(p.layers)) p.layers[k] = fix(p.layers[k]);
  }
}
function clearBar(P, p, bar, what) {
  const n = spb(P), a = bar * n, keep = x => x.step < a || x.step >= a + n;
  if (what === "drums" || what === "all") for (const d of DRUMS) p.drums[d.id] = p.drums[d.id].filter(s => s < a || s >= a + n);
  if (what === "melody" || what === "all") p.melody = p.melody.filter(keep);
  if (what === "layers" || what === "all") for (const k of Object.keys(p.layers)) p.layers[k] = p.layers[k].filter(keep);
  if (what && what.startsWith("layer:")) { const k = what.slice(6); if (p.layers[k]) p.layers[k] = p.layers[k].filter(keep); }
  if (what === "chords" || what === "all") p.chords[bar] = -1;
}
function copyBarNext(P, p, bar) {
  const n = spb(P); if (bar + 1 >= p.bars) return false;
  const a = bar * n, b = (bar + 1) * n, shift = list => list.filter(x => x.step < b || x.step >= b + n).concat(list.filter(x => x.step >= a && x.step < b).map(x => ({ ...x, step: x.step + n }))).sort((x, y) => x.step - y.step);
  for (const d of DRUMS) p.drums[d.id] = [...new Set(p.drums[d.id].filter(s => s < b || s >= b + n).concat(p.drums[d.id].filter(s => s >= a && s < b).map(s => s + n)))].sort((x, y) => x - y);
  p.melody = shift(p.melody); for (const k of Object.keys(p.layers)) p.layers[k] = shift(p.layers[k]);
  p.chords[bar + 1] = p.chords[bar]; return true;
}

// ---------- ABC export ----------
const MULTS = [48, 32, 24, 16, 12, 8, 6, 4, 3, 2, 1];
function rests(n) { let s = ""; for (const m of MULTS) while (n >= m) { s += "z" + (m === 1 ? "" : m); n -= m; } return s; }
const dur = n => n === 1 ? "" : String(n);
function abcPitch(midi, barState, k) {
  const sp = spell(midi, k.sig, k.f), L = sp.letter, active = L in barState ? barState[L] : (k.sig[L] || 0);
  let acc = ""; if (sp.alt !== active) { acc = ACC_TEXT[sp.alt]; barState[L] = sp.alt; }
  return acc + (sp.octave >= 5 ? L.toLowerCase() + "'".repeat(sp.octave - 5) : L + ",".repeat(4 - sp.octave));
}
function eventsBar(P, events, n, k, prefix) {   // monophonic [{step, midi, len}] (step relative to bar) -> bar text
  if (!events.length) return prefix ? prefix + rests(n) : "Z";
  const st = {}; let out = prefix || "", cursor = 0;
  for (const e of events) { if (e.step < cursor) continue; const len = Math.min(e.len, n - e.step); if (e.step > cursor) out += rests(e.step - cursor); out += abcPitch(e.midi, st, k) + dur(len); cursor = e.step + len; }
  if (cursor < n) out += rests(n - cursor);
  return out;
}
function vocalBar(P, p, bar, withChords, k) {
  const n = spb(P), base = bar * n, ch = withChords ? barChord(P, p, bar) : null;
  const ev = p.melody.filter(x => x.step >= base && x.step < base + n).sort((a, b) => a.step - b.step).map(x => ({ step: x.step - base, midi: midiOfRow(P, x.row), len: x.len }));
  return eventsBar(P, ev, n, k, ch ? `"${ch.symbol}"` : "");
}
function insBar(P, p, bar, k) { return eventsBar(P, bassEvents(P, p, bar), spb(P), k, ""); }
function layerBar(P, p, layer, bar, k) {   // polyphonic layer -> chords in brackets, duration until the next onset
  const n = spb(P), base = bar * n, byStep = new Map();
  for (const x of (p.layers[layer] || [])) if (x.step >= base && x.step < base + n) { const s = x.step - base; if (!byStep.has(s)) byStep.set(s, []); byStep.get(s).push(x); }
  const steps = [...byStep.keys()].sort((a, b) => a - b);
  if (!steps.length) return "Z";
  const st = {}; let out = "", cursor = 0;
  steps.forEach((s, i) => {
    if (s > cursor) out += rests(s - cursor);
    const notes = byStep.get(s), len = Math.min((i + 1 < steps.length ? steps[i + 1] : n) - s, Math.max(...notes.map(x => x.len)));
    const pitches = [...new Set(notes.map(x => x.midi))].sort((a, b) => a - b).map(m => abcPitch(m, st, k));
    out += (pitches.length > 1 ? `[${pitches.join("")}]` : pitches[0]) + dur(len); cursor = s + len;
    const gap = (i + 1 < steps.length ? steps[i + 1] : n) - cursor; if (gap > 0) { out += rests(gap); cursor += gap; }
  });
  return out;
}
function drumBar(P, p, bar) {
  const n = spb(P), base = bar * n, hits = new Map();
  for (const d of DRUMS) for (const s of p.drums[d.id]) if (s >= base && s < base + n) hits.set(s - base, (hits.get(s - base) || "") + d.perc);
  const steps = [...hits.keys()].sort((a, b) => a - b);
  if (!steps.length) return rests(n);
  let out = "", cursor = 0;
  steps.forEach((s, i) => { if (s > cursor) out += rests(s - cursor); const len = (i + 1 < steps.length ? steps[i + 1] : n) - s, h = hits.get(s); out += (h.length > 1 ? `[${h}]` : h) + dur(len); cursor = s + len; });
  return out;
}
function header(P, k) { return ["X:1", `T:${(P.title || "Groove Box sketch").replace(/\n/g, " ")}`, `M:${P.meter}`, `L:1/${P.grid}`, `Q:1/4=${P.bpm}`, `K:${k.field}`]; }
function byId(P, id) { return P.patterns.find(p => p.id === id) || P.patterns[0]; }
function sectionBars(P, part) { const p = byId(P, part.pattern), out = []; for (let r = 0; r < part.repeat; r++) for (let b = 0; b < p.bars; b++) out.push([p, b]); return out; }
function lines(bars) { const out = []; for (let i = 0; i < bars.length; i += 4) out.push(bars.slice(i, i + 4).join(" | ") + " |"); return out; }
function songParts(P) { return P.song.length ? P.song : [{ pattern: P.patterns[0].id, repeat: 1, section: "verse" }]; }
function exportYuE2(P, withChords) {
  const k = keyInfo(P), out = header(P, k);
  for (const part of songParts(P)) {
    const bars = sectionBars(P, part);
    out.push(`% ${part.section}`);
    out.push("V: Vocal", ...lines(bars.map(([p, b]) => vocalBar(P, p, b, withChords, k))));
    out.push("V: Ins", ...lines(bars.map(([p, b]) => insBar(P, p, b, k))));
  }
  return out.join("\n") + "\n";
}
function layerIds(P) {   // extra layers that actually hold notes, in deck order
  const ids = new Set(); for (const p of P.patterns) for (const k of Object.keys(p.layers)) if (k !== "bass" && p.layers[k].length) ids.add(k);
  return [...ids].sort((a, b) => P.deck.findIndex(i => i.id === a) - P.deck.findIndex(i => i.id === b));
}
function exportStandard(P) {
  const k = keyInfo(P), out = header(P, k), layers = layerIds(P);
  out.splice(out.length - 1, 0, ...DRUMS.map(d => `%%percmap ${d.perc} ${d.gm}${d.head ? " " + d.head : ""}`));
  out.push(`V:1 clef=treble name="Melody"`, `V:2 clef=bass name="Bass"`);
  layers.forEach((id, i) => { const inst = P.deck.find(x => x.id === id); out.push(`V:${i + 3} clef=treble name="${(inst ? inst.name : id).replace(/"/g, "")}"`); });
  out.push(`V:${layers.length + 3} clef=perc name="Drums"`);
  for (const part of songParts(P)) {
    const bars = sectionBars(P, part);
    out.push(`% ${part.section}`);
    out.push("[V:1]", ...lines(bars.map(([p, b]) => vocalBar(P, p, b, true, k))));
    out.push("[V:2]", ...lines(bars.map(([p, b]) => insBar(P, p, b, k))));
    layers.forEach((id, i) => out.push(`[V:${i + 3}]`, ...lines(bars.map(([p, b]) => layerBar(P, p, id, b, k)))));
    out.push(`[V:${layers.length + 3}]`, "%%MIDI channel 10", ...lines(bars.map(([p, b]) => drumBar(P, p, b))));
  }
  return out.join("\n") + "\n";
}
function exportAbc(P, flavour) { return flavour === "standard" ? exportStandard(P) : exportYuE2(P, flavour !== "yue2melody"); }
function scorePackage(P, abc) {
  return { format: "yue2-score", version: 1, abc: abc || exportYuE2(P, true), style: "", lyrics: "", seed: 0, max_duration: 240, edited_with: "yue2-groove-box" };
}
// Bar-length check in the Score Studio's terms (same tokenizer as docs/index.html, plus bracket chords).
const TOKEN = /"[^"]*"|\[[A-Za-z]:[^\]]*\]|\[[^\]]+\]\d*|[_^=]*[A-Ga-g][',]*\d*-?|z\d*|Z\d*|\s+|./g;
function checkAbc(P, abc) {
  const want = beats(P) / 4 * P.grid, issues = [], bars = {}; let voice = null, section = 0;
  for (const line of abc.split("\n")) {
    if (/^%\s*\S/.test(line) && !/^%%/.test(line)) { section++; voice = null; continue; }
    const v = /^\[?V:\s*(\S+?)\]?\s*$/.exec(line); if (v) { voice = v[1]; continue; }
    if (!voice || /^[A-Za-z]:/.test(line) || /^%%/.test(line) || !line.trim()) continue;
    for (const bar of line.split("|")) {
      const t = bar.trim(); if (!t) continue;
      bars[voice] = (bars[voice] || 0) + (/^Z(\d*)$/.test(t) ? (+t.slice(1) || 1) : 1);
      if (/^Z\d*$/.test(t)) continue;
      let units = 0;
      for (const tok of t.match(TOKEN) || []) {
        if (/^\s+$/.test(tok) || tok.startsWith('"')) continue;
        const m = /(\d+)-?$/.exec(tok);
        if (/^[\[_^=]*[A-Ga-g]/.test(tok) || /^z/.test(tok)) units += m ? +m[1] : 1;
        else issues.push(`Unsupported symbol "${tok}" in section ${section}.`);
      }
      if (units !== want) issues.push(`Bar with ${units} units (expected ${want}) in section ${section}, ${voice}: “${t.slice(0, 32)}”`);
    }
  }
  const counts = Object.values(bars);
  if (counts.length > 1 && counts.some(c => c !== counts[0])) issues.push("Voices have different bar counts.");
  return { issues, bars: counts[0] || 0 };
}

// ---------- M3DS score PNG (same container as the Score Studio / m3ds.py; needs pako) ----------
const HEADER_SIZE = 40, FLAG_GZIP = 1;
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function encodeM3DS(data, fname, minSide) {
  minSide = minSide || 256;
  const blob = window.pako.gzip(data, { level: 9 }), fb = new TextEncoder().encode(fname);
  const raw0 = new Uint8Array(HEADER_SIZE + fb.length + blob.length), dv = new DataView(raw0.buffer);
  raw0.set([77, 51, 68, 83], 0); dv.setUint8(4, 1); dv.setUint8(5, FLAG_GZIP); dv.setUint16(6, 0); dv.setUint16(8, 1);
  dv.setBigUint64(10, BigInt(blob.length)); dv.setUint32(18, blob.length); dv.setUint32(22, crc32(blob));
  dv.setBigUint64(26, BigInt(data.length)); dv.setUint32(34, crc32(data)); dv.setUint16(38, fb.length);
  raw0.set(fb, HEADER_SIZE); raw0.set(blob, HEADER_SIZE + fb.length);
  const pixels = Math.ceil(raw0.length / 3), w = Math.max(minSide, Math.ceil(Math.sqrt(pixels))), h = Math.max(minSide, Math.ceil(pixels / w));
  const rgb = new Uint8Array(w * h * 3); rgb.set(raw0);
  return writePngRGB(rgb, w, h);
}
function writePngRGB(rgb, w, h) {
  const rowLen = w * 3, filtered = new Uint8Array((rowLen + 1) * h);
  for (let y = 0; y < h; y++) { filtered[y * (rowLen + 1)] = 0; filtered.set(rgb.subarray(y * rowLen, (y + 1) * rowLen), y * (rowLen + 1) + 1); }
  const chunk = (type, body) => { const out = new Uint8Array(12 + body.length), dv = new DataView(out.buffer); dv.setUint32(0, body.length); out.set(new TextEncoder().encode(type), 4); out.set(body, 8); dv.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length))); return out; };
  const ihdr = new Uint8Array(13), idv = new DataView(ihdr.buffer); idv.setUint32(0, w); idv.setUint32(4, h); ihdr.set([8, 2, 0, 0, 0], 8);
  return new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", window.pako.deflate(filtered, { level: 9 })), chunk("IEND", new Uint8Array(0))], { type: "image/png" });
}

// ---------- storage (shared between the stage and the editor) ----------
const AUTOSAVE = "yue2-groovebox:autosave", LIB = "yue2-groovebox:library", HANDOFF = "yue2-handoff";
function loadAutosave() { try { const p = JSON.parse(localStorage.getItem(AUTOSAVE) || "null"); return p && p.patterns ? normalizeProject(p) : null; } catch (e) { return null; } }
function saveAutosave(P) { try { localStorage.setItem(AUTOSAVE, JSON.stringify(P)); return true; } catch (e) { return false; } }
function library() { try { return JSON.parse(localStorage.getItem(LIB) || "[]"); } catch (e) { return []; } }
function setLibrary(items) { try { localStorage.setItem(LIB, JSON.stringify(items)); return true; } catch (e) { return false; } }
function saveToLibrary(P, name) { const items = library().filter(x => x.name !== name); items.unshift({ id: uid(), name, saved: Date.now(), project: clone(P) }); return setLibrary(items.slice(0, 50)); }
const safeName = s => (s || "groove").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "groove";
function download(blob, name) { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }

// ---------- sequencer (shared; plays through a synth with note(ch, midi, t, dur, vel) / drum(gm, t, vel) / channelFor(inst)) ----------
function Sequencer(opts) {   // opts: project(), currentPattern(), synth(), onStep(sIn, entry, p), options()
  const S = { playing: false, mode: "loop", pos: 0, nextTime: 0, anchorTime: 0, timer: null, seq: [], total: 0, uiTimers: [] };
  const P = () => opts.project(), synth = () => opts.synth(), now = () => synth().now();
  const stepDur = () => 60 / P().bpm / (P().grid / 4);
  function buildSeq() {
    const out = [], cur = opts.currentPattern();
    if (S.mode === "loop") { for (let b = 0; b < cur.bars; b++) out.push({ pid: cur.id, bar: b, part: -1 }); }
    else P().song.forEach((part, pi) => { const p = byId(P(), part.pattern); for (let r = 0; r < part.repeat; r++) for (let b = 0; b < p.bars; b++) out.push({ pid: p.id, bar: b, part: pi }); });
    return out.length ? out : [{ pid: cur.id, bar: 0, part: -1 }];
  }
  function start() {
    if (!synth().ensure()) return false;
    stop(true);
    S.seq = buildSeq(); S.total = S.seq.length * spb(P()); S.pos = 0;
    S.nextTime = now() + 0.1; S.anchorTime = S.nextTime; S.playing = true;
    S.timer = setInterval(tick, 25); tick(); return true;
  }
  function stop(silent) {
    clearInterval(S.timer); S.timer = null; S.playing = false;
    S.uiTimers.forEach(clearTimeout); S.uiTimers = [];
    if (synth().allOff) synth().allOff();
    if (!silent && opts.onStep) opts.onStep(-1);
  }
  function tick() {
    const Pj = P(), ahead = now() + 0.16, sd = stepDur(), n = spb(Pj), o = opts.options ? opts.options() : {};
    while (S.nextTime < ahead) {
      const pos = S.pos, entry = S.seq[Math.floor(pos / n)], sIn = pos % n, p = byId(Pj, entry.pid), abs = entry.bar * n + sIn;
      let t = S.nextTime; if (sIn % 2 === 1) t += Pj.swing / 100 * sd * 0.5;
      const sy = synth();
      for (const d of DRUMS) if (p.drums[d.id].includes(abs)) sy.drum(d.gm, t, 1);
      for (const note of p.melody) if (note.step === abs) sy.note(sy.channelFor("voice"), midiOfRow(Pj, note.row), t, note.len * sd * 0.95, 0.9);
      for (const id of Object.keys(p.layers)) { if (id === "bass") continue; for (const x of p.layers[id]) if (x.step === abs) sy.note(sy.channelFor(id), x.midi, t, x.len * sd * 0.95, 0.85); }
      if (o.hearBass !== false) for (const e of bassEvents(Pj, p, entry.bar)) if (e.step === sIn) sy.note(sy.channelFor("bass"), e.midi, t, e.len * sd * 0.9, 0.95);
      if (sIn === 0 && o.hearChords !== false) { const c = barChord(Pj, p, entry.bar); if (c) sy.chord(sy.channelFor("chords"), c.voicing, t, n * sd * 0.98, 0.55); }
      if (opts.onStep) { const delay = Math.max(0, (S.nextTime - now()) * 1000); S.uiTimers.push(setTimeout(() => { S.uiTimers.shift(); opts.onStep(sIn, entry, p); }, delay)); }
      S.nextTime += sd; S.pos = (S.pos + 1) % S.total;
      if (S.pos === 0) { S.anchorTime = S.nextTime; const seq = buildSeq(); S.seq = seq; S.total = seq.length * n; }
    }
  }
  function quantizedHit() {   // where "now" lands in the playing sequence -> {p, abs, sIn, entry}
    const n = spb(P()), sd = stepDur();
    let pos = Math.round((now() - S.anchorTime) / sd); pos = ((pos % S.total) + S.total) % S.total;
    const entry = S.seq[Math.floor(pos / n)]; return { p: byId(P(), entry.pid), abs: entry.bar * n + pos % n, sIn: pos % n, entry };
  }
  function stepsHeld(seconds) { return Math.max(1, Math.round(seconds / stepDur())); }
  function retime() { if (S.playing) S.anchorTime = S.nextTime - S.pos * stepDur(); }
  function setMode(m) { S.mode = m; if (S.playing) start(); }
  return { state: S, start, stop, quantizedHit, stepsHeld, retime, setMode, stepDur, get playing() { return S.playing; }, get mode() { return S.mode; } };
}

window.Groove = { uid, clone, clamp, KEYS, SCALES, DRUMS, DRUM_BY_ID, SECTION_TYPES, SOUNDS, SOUND_BY_ID, CONTROLLERS, ROLE_LABEL, SOLFEGE,
  newPattern, defaultDeck, demoProject, blankProject, normalizeProject, beats, spb, scaleDef, nRows, tonicPc, midiOfRow, rowOfMidi, keyInfo, noteName, rowName,
  chordInfo, barChord, bassEvents, toggleDrum, addDrumHit, addMelodyNote, noteAt, addLayerNote, setBars, remapSteps, clearBar, copyBarNext,
  exportYuE2, exportStandard, exportAbc, scorePackage, checkAbc, encodeM3DS, byId, layerIds,
  AUTOSAVE, LIB, HANDOFF, loadAutosave, saveAutosave, library, setLibrary, saveToLibrary, safeName, download, Sequencer };
})();
