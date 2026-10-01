/* YuE2 Groove Box — sound engine. FluidSynth (WebAssembly, via js-synthesizer) playing vendor/groovebox-gm.sf3,
   with a small oscillator engine as the fallback while the SoundFont loads or when it can't. Exposes window.GrooveSynth.
   Channel plan: each stage instrument gets its own MIDI channel; drums are channel 9. */
(function () {
"use strict";
const VENDOR = (document.currentScript && document.currentScript.src ? document.currentScript.src.replace(/[^/]*$/, "") : "") + "vendor/";
const FLUID_JS = "libfluidsynth-2.3.0-with-libsndfile.js", SYNTH_JS = "js-synthesizer.js", WORKLET_JS = "js-synthesizer.worklet.js", SF = "groovebox-gm.sf3";
const E = { ac: null, master: null, noise: null, fluid: null, fluidNode: null, sfont: null, status: "idle", engine: "osc", error: "", volume: 0.8,
            channels: new Map(), programs: new Map(), nextChannel: 0, timers: new Set(), live: new Map(), deck: [], drumProgram: 0 };
const now = () => E.ac ? E.ac.currentTime : 0;

function ensure() {
  if (!E.ac) {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
    E.ac = new AC({ latencyHint: "interactive" });
    E.master = E.ac.createGain(); E.master.gain.value = E.volume * 0.9;
    const comp = E.ac.createDynamicsCompressor(); comp.threshold.value = -10; comp.ratio.value = 3;
    E.master.connect(comp); comp.connect(E.ac.destination);
    const buf = E.ac.createBuffer(1, E.ac.sampleRate * 2, E.ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    E.noise = buf;
  }
  if (E.ac.state === "suspended") E.ac.resume();
  return true;
}
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("couldn't load " + src.split("/").pop())); document.head.appendChild(s); }); }

// Load FluidSynth + the SoundFont. Safe to call more than once; resolves to the engine name.
let loading = null;
function load(onProgress) {
  if (loading) return loading;
  const progress = (msg, frac) => { E.progress = { msg, frac }; if (onProgress) onProgress(msg, frac); };
  loading = (async () => {
    if (!ensure()) throw new Error("no Web Audio");
    E.status = "loading";
    progress("Loading synthesizer…", 0.05);
    await loadScript(VENDOR + FLUID_JS); await loadScript(VENDOR + SYNTH_JS);
    await window.JSSynth.waitForReady();
    progress("Loading instruments…", 0.3);
    const resp = await fetch(VENDOR + SF); if (!resp.ok) throw new Error("SoundFont missing (" + resp.status + ")");
    const sf = await resp.arrayBuffer();
    progress("Warming up…", 0.7);
    let synth = null;
    try {   // AudioWorklet: rendering off the main thread, lowest latency
      await E.ac.audioWorklet.addModule(VENDOR + FLUID_JS); await E.ac.audioWorklet.addModule(VENDOR + WORKLET_JS);
      synth = new window.JSSynth.AudioWorkletNodeSynthesizer(); synth.init(E.ac.sampleRate, { polyphony: 96 });
      E.fluidNode = synth.createAudioNode(E.ac); E.fluidNode.connect(E.master);
    } catch (e) {   // ScriptProcessor fallback
      console.warn("AudioWorklet unavailable, using ScriptProcessor:", e.message);
      synth = new window.JSSynth.Synthesizer(); synth.init(E.ac.sampleRate, { polyphony: 96 });
      E.fluidNode = synth.createAudioNode(E.ac, 2048); E.fluidNode.connect(E.master);
    }
    E.sfont = await synth.loadSFont(sf);
    E.fluid = synth; await applyPrograms();
    E.status = "ready"; E.engine = "fluid"; progress("Ready", 1);
    return "fluid";
  })().catch(err => { console.warn("FluidSynth unavailable:", err); E.status = "fallback"; E.engine = "osc"; E.error = err.message; progress("Using the built-in sketch sounds (" + err.message + ")", 1); return "osc"; });
  return loading;
}

// ----- instruments -> channels -----
function setDeck(deck) {   // deck: [{id, role, sound: {program, drumkit}}]
  E.deck = deck; E.channels = new Map(); E.programs = new Map(); E.nextChannel = 0; E.drumProgram = 0;
  const take = () => { let ch = E.nextChannel++; if (ch === 9) ch = E.nextChannel++; return Math.min(ch, 15); };
  for (const inst of deck) {
    if (inst.sound.drumkit) { E.drumProgram = inst.sound.program; continue; }
    const ch = take(); E.channels.set(inst.id, ch); E.programs.set(ch, inst.sound.program);
    if (inst.role && !E.channels.has(inst.role)) E.channels.set(inst.role, ch);
  }
  const defaults = { voice: 53, bass: 33, chords: 4 };
  for (const role of Object.keys(defaults)) if (!E.channels.has(role)) { const ch = take(); E.channels.set(role, ch); E.programs.set(ch, defaults[role]); }
  if (E.fluid) applyPrograms();
}
async function applyPrograms() {
  if (!E.fluid) return;
  for (const [ch, prog] of E.programs) { E.fluid.midiProgramSelect(ch, E.sfont, 0, prog); E.fluid.midiControl(ch, 91, 40); }
  E.fluid.midiSetChannelType(9, true); E.fluid.midiProgramSelect(9, E.sfont, 128, E.drumProgram);
}
function channelFor(key) { if (!E.channels.size) setDeck([]); return E.channels.has(key) ? E.channels.get(key) : E.channels.get("voice"); }
function programOf(ch) { return E.programs.get(ch) || 0; }

// ----- scheduling helpers -----
function at(t, fn) {
  const delay = (t - now()) * 1000;
  if (delay <= 4) { fn(); return; }
  const id = setTimeout(() => { E.timers.delete(id); fn(); }, delay); E.timers.add(id);
}
function allOff() {
  for (const id of E.timers) clearTimeout(id); E.timers.clear();
  if (E.fluid) E.fluid.midiAllNotesOff();
  for (const v of E.live.values()) v.stop(now()); E.live.clear();
}
function setVolume(v) { E.volume = v; if (E.master) E.master.gain.value = v * 0.9; }

// ----- playing -----
function note(ch, midi, t, dur, vel) {
  if (!ensure()) return;
  t = Math.max(t, now()); vel = vel == null ? 0.9 : vel;
  if (E.engine === "fluid") { at(t, () => E.fluid.midiNoteOn(ch, midi, Math.round(vel * 127))); at(t + Math.max(0.04, dur), () => E.fluid.midiNoteOff(ch, midi)); }
  else { at(t, () => { const v = oscVoice(programOf(ch), midi, now(), vel); v.stop(now() + Math.max(0.04, dur)); }); }
}
function chord(ch, midis, t, dur, vel) { midis.forEach((m, i) => note(ch, m, t + i * 0.02, dur, vel)); }
function drum(gm, t, vel) {
  if (!ensure()) return; t = Math.max(t, now()); vel = vel == null ? 1 : vel;
  if (E.engine === "fluid") { at(t, () => { E.fluid.midiNoteOn(9, gm, Math.round(vel * 127)); }); at(t + 0.08, () => E.fluid.midiNoteOff(9, gm)); }
  else at(t, () => oscDrum(gm, now(), vel));
}
// Live (held) notes: key = anything unique per finger/note.
function noteOn(key, ch, midi, vel) {
  if (!ensure()) return; vel = vel == null ? 0.9 : vel;
  noteOff(key);
  if (E.engine === "fluid") { E.fluid.midiNoteOn(ch, midi, Math.round(vel * 127)); E.live.set(key, { stop: () => E.fluid.midiNoteOff(ch, midi) }); }
  else E.live.set(key, oscVoice(programOf(ch), midi, now(), vel));
}
function noteOff(key) { const v = E.live.get(key); if (v) { v.stop(now()); E.live.delete(key); } }

// ----- oscillator fallback -----
function env(t, peak, decay, g) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + 0.003); g.gain.exponentialRampToValueAtTime(0.0001, t + decay); }
function noiseVoice(t, o) {
  const ac = E.ac, src = ac.createBufferSource(); src.buffer = E.noise; src.loop = true; let node = src;
  if (o.hp) { const f = ac.createBiquadFilter(); f.type = "highpass"; f.frequency.value = o.hp; node.connect(f); node = f; }
  if (o.bp) { const f = ac.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = o.bp; f.Q.value = o.q || 1; node.connect(f); node = f; }
  const g = ac.createGain(); env(t, o.peak, o.decay, g); node.connect(g); g.connect(E.master); src.start(t); src.stop(t + o.decay + 0.05);
}
function oscDrum(gm, t, vel) {
  const ac = E.ac, k = vel;
  const tone = (f0, f1, sweep, peak, decay, type) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = type || "sine"; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + sweep); env(t, peak * k, decay, g); o.connect(g); g.connect(E.master); o.start(t); o.stop(t + decay + 0.05); };
  switch (gm) {
    case 36: tone(160, 42, 0.11, 1.0, 0.38); tone(900, 200, 0.02, 0.3, 0.03, "triangle"); break;
    case 38: tone(210, 160, 0.05, 0.35, 0.12, "triangle"); noiseVoice(t, { hp: 1200, bp: 2600, q: 0.8, peak: 0.55 * k, decay: 0.19 }); break;
    case 37: tone(900, 500, 0.02, 0.3, 0.06, "triangle"); noiseVoice(t, { bp: 3200, q: 2, peak: 0.3 * k, decay: 0.05 }); break;
    case 39: [0, 0.012, 0.025].forEach(dt => noiseVoice(t + dt, { bp: 1400, q: 1.2, peak: 0.45 * k, decay: 0.05 })); noiseVoice(t + 0.03, { bp: 1300, q: 1, peak: 0.4 * k, decay: 0.2 }); break;
    case 42: noiseVoice(t, { hp: 7500, peak: 0.3 * k, decay: 0.05 }); break;
    case 46: noiseVoice(t, { hp: 6500, peak: 0.3 * k, decay: 0.3 }); break;
    case 45: tone(190, 95, 0.2, 0.7, 0.32); break;
    case 41: tone(130, 65, 0.25, 0.7, 0.4); break;
    case 70: noiseVoice(t, { hp: 5000, bp: 7000, q: 1.5, peak: 0.25 * k, decay: 0.07 }); break;
    case 49: noiseVoice(t, { hp: 3000, peak: 0.35 * k, decay: 0.9 }); break;
    default: tone(300, 150, 0.05, 0.4, 0.1);
  }
}
function oscVoice(program, midi, t, vel) {
  const ac = E.ac, f = 440 * Math.pow(2, (midi - 69) / 12), bass = program >= 32 && program <= 39, voice = program === 52 || program === 53;
  const pluck = [24, 46, 107, 108, 12, 11, 114, 113, 115].includes(program);
  const o = ac.createOscillator(), o2 = ac.createOscillator(), filt = ac.createBiquadFilter(), g = ac.createGain(), o2g = ac.createGain();
  o.type = bass ? "sawtooth" : voice ? "sine" : pluck ? "triangle" : "triangle"; o2.type = voice ? "triangle" : "sine";
  o.frequency.value = f; o2.frequency.value = f * 2.001; o2.detune.value = 4; o2g.gain.value = voice ? 0.15 : 0.3;
  filt.type = "lowpass"; filt.frequency.setValueAtTime(bass ? 900 : 2600, t); if (bass) filt.frequency.exponentialRampToValueAtTime(220, t + 0.25);
  o.connect(filt); o2.connect(o2g); o2g.connect(filt); filt.connect(g); g.connect(E.master);
  const peak = 0.45 * vel;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + (voice ? 0.06 : 0.008));
  if (pluck) g.gain.setTargetAtTime(0.0001, t + 0.02, 0.35);
  o.start(t); o2.start(t);
  return { stop(t1) { g.gain.setTargetAtTime(0.0001, t1, 0.04); o.stop(t1 + 0.3); o2.stop(t1 + 0.3); } };
}

window.GrooveSynth = { ensure, now, load, setDeck, channelFor, note, chord, drum, noteOn, noteOff, allOff, setVolume,
  get status() { return E.status; }, get engine() { return E.engine; }, get error() { return E.error; }, get progress() { return E.progress; }, get context() { return E.ac; } };
})();
