'use strict';

/* ---------- RNG (mulberry32) ---------- */
/* gameplay RNG — seedable for daily challenges. Cosmetic effects use CRNG below so they
   never desync a seeded run. */
const RNG = {
  s: (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0,
  seed(v) { this.s = (v >>> 0) || 1; },
  next() {
    this.s = (this.s + 0x6D2B79F5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  },
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); },
  chance(p) { return this.next() < p; },
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; },
  weighted(pool) { // pool: [[value, weight], ...]
    let total = 0;
    for (const [, w] of pool) total += w;
    let r = this.next() * total;
    for (const [v, w] of pool) { if ((r -= w) <= 0) return v; }
    return pool[pool.length - 1][0];
  },
};

/* cosmetic randomness (particles, shake, music) — independent of gameplay RNG */
const CRNG = {
  next() { return Math.random(); },
  int(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); },
  chance(p) { return Math.random() < p; },
  pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; },
};

/* ---------- math helpers ---------- */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const lerp = (a, b, t) => a + (b - a) * t;
const dist2 = (x1, y1, x2, y2) => { const dx = x1 - x2, dy = y1 - y2; return dx * dx + dy * dy; };
const cheb = (x1, y1, x2, y2) => Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));

const DIRS8 = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];

/* ---------- color shading (cached) ---------- */
const _shadeCache = new Map();
function shade(hex, f) {
  const key = hex + '|' + (f = Math.round(clamp(f, 0, 1.4) * 40) / 40);
  let v = _shadeCache.get(key);
  if (!v) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    v = `rgb(${Math.min(255, Math.round(r * f))},${Math.min(255, Math.round(g * f))},${Math.min(255, Math.round(b * f))})`;
    _shadeCache.set(key, v);
  }
  return v;
}

/* ---------- sound (WebAudio synth) ---------- */
const Sfx = {
  ctx: null,
  muted: false,
  vol: 1,
  ensure() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { this.muted = true; }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(freq, dur, type = 'square', vol = 0.10, slide = 0, delay = 0) {
    if (this.muted || !this.ctx || this.vol <= 0) return;
    vol *= this.vol;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  },
  hit()        { this.tone(140, 0.10, 'square', 0.09, -60); },
  crit()       { this.tone(190, 0.14, 'sawtooth', 0.11, -120); },
  hurt()       { this.tone(80, 0.22, 'sawtooth', 0.13, -40); },
  kill()       { this.tone(220, 0.25, 'triangle', 0.10, -170); },
  pickup()     { this.tone(520, 0.07, 'square', 0.07); this.tone(780, 0.09, 'square', 0.07, 0, 0.07); },
  gold()       { this.tone(880, 0.06, 'triangle', 0.08); this.tone(1175, 0.08, 'triangle', 0.08, 0, 0.05); },
  potion()     { this.tone(330, 0.12, 'sine', 0.10, 160); },
  scroll()     { this.tone(620, 0.18, 'sine', 0.09, 240); },
  equip()      { this.tone(240, 0.10, 'square', 0.09); this.tone(360, 0.10, 'square', 0.09, 0, 0.08); },
  stairs()     { this.tone(300, 0.14, 'triangle', 0.10, -120); this.tone(200, 0.18, 'triangle', 0.10, -90, 0.12); },
  levelup()    { [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.14, 'triangle', 0.10, 0, i * 0.09)); },
  fireball()   { this.tone(120, 0.35, 'sawtooth', 0.13, -80); this.tone(900, 0.25, 'sawtooth', 0.05, -700); },
  bolt()       { this.tone(700, 0.12, 'sawtooth', 0.08, -450); },
  trap()       { this.tone(160, 0.20, 'square', 0.12, -100); },
  chest()      { this.tone(290, 0.09, 'triangle', 0.09); this.tone(440, 0.09, 'triangle', 0.09, 0, 0.08); this.tone(660, 0.12, 'triangle', 0.09, 0, 0.16); },
  die()        { [180, 140, 100, 60].forEach((f, i) => this.tone(f, 0.3, 'sawtooth', 0.11, -20, i * 0.18)); },
  win()        { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.3, 'triangle', 0.10, 0, i * 0.13)); },
  freeze()     { this.tone(1400, 0.25, 'sine', 0.09, -900); this.tone(900, 0.2, 'sine', 0.06, -500, 0.06); },
  whisper()    { this.tone(190, 0.5, 'sine', 0.05, -130); this.tone(96, 0.62, 'sine', 0.04, -36, 0.1); },
  firebolt()   { this.tone(500, 0.18, 'sawtooth', 0.09, -320); },
  mend()       { this.tone(440, 0.16, 'sine', 0.09, 220); this.tone(660, 0.18, 'sine', 0.07, 160, 0.1); },
  buy()        { this.tone(660, 0.07, 'triangle', 0.09); this.tone(880, 0.07, 'triangle', 0.09, 0, 0.07); this.tone(1320, 0.1, 'triangle', 0.08, 0, 0.14); },
  lob()        { this.tone(380, 0.30, 'sine', 0.09, 520); },                                       // shell tossed skyward: rising whistle
  shellFall()  { this.tone(980, 0.45, 'sine', 0.09, -700); },                                      // incoming: long falling whistle
  burst()      { this.tone(90, 0.30, 'sawtooth', 0.14, -50); this.tone(260, 0.18, 'square', 0.08, -180, 0.02); },
  gallopWarn() { this.tone(95, 0.12, 'square', 0.11, -25); this.tone(95, 0.12, 'square', 0.11, -25, 0.16); }, // hooves paw the ground, twice
  gallop()     { [0, 0.09, 0.18, 0.27].forEach((d, i) => this.tone(130 - i * 12, 0.09, 'square', 0.11, -20, d)); },
  daze()       { this.tone(520, 0.28, 'triangle', 0.09, -340); this.tone(390, 0.22, 'triangle', 0.07, -240, 0.12); },
};

/* ---------- per-floor ambient soundscapes ---------- */
const Ambient = {
  timer: null, kind: null, noiseBuf: null,
  set(kind) {
    this.kind = kind || 'plain';
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!Sfx.ctx) return;
    this.schedule();
  },
  noise() {
    if (!this.noiseBuf) {
      const c = Sfx.ctx;
      this.noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noiseBuf;
  },
  gust(freq, dur, vol) { // filtered-noise swell (wind, distant water)
    if (Sfx.muted || !Sfx.ctx || Sfx.vol <= 0) return;
    const c = Sfx.ctx, t0 = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise();
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol * Sfx.vol, t0 + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt).connect(g).connect(c.destination);
    src.start(t0); src.stop(t0 + dur + 0.05);
  },
  schedule() {
    const k = this.kind;
    let next = 4000 + CRNG.next() * 5000;
    if (!Sfx.muted) {
      if (k === 'FLOODED HALLS') {
        Sfx.tone(820 + CRNG.next() * 500, 0.09, 'sine', 0.045, -520);
        if (CRNG.chance(0.4)) Sfx.tone(560 + CRNG.next() * 300, 0.12, 'sine', 0.03, -380, 0.22);
        next = 1800 + CRNG.next() * 3200;
      } else if (k === 'HALLS OF BONE') {
        [0, 0.08, 0.19].forEach(d => Sfx.tone(150 + CRNG.next() * 90, 0.04, 'square', 0.028, -40, d));
        next = 5000 + CRNG.next() * 6000;
      } else if (k === 'THE LIGHTLESS') {
        this.gust(240, 2.6, 0.05);
        next = 5500 + CRNG.next() * 5000;
      } else if (CRNG.chance(0.35)) { // plain halls: rare distant rumbles
        this.gust(120, 2.0, 0.025);
      }
    }
    this.timer = setTimeout(() => this.schedule(), next);
  },
};

/* ---------- ambient music (procedural dark drone + plucks) ---------- */
const Music = {
  started: false, master: null, timer: null,
  start() {
    if (this.started || !Sfx.ctx) return;
    this.started = true;
    const c = Sfx.ctx;
    this.master = c.createGain();
    this.master.connect(c.destination);
    this.applyGain();
    // low drone: two detuned sines through a slow tremolo
    const droneGain = c.createGain();
    droneGain.gain.value = 0.028;
    droneGain.connect(this.master);
    for (const f of [55, 55.4, 82.5]) {
      const o = c.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      o.connect(droneGain); o.start();
    }
    const lfo = c.createOscillator(), lfoGain = c.createGain();
    lfo.frequency.value = 0.07; lfoGain.gain.value = 0.012;
    lfo.connect(lfoGain); lfoGain.connect(droneGain.gain); lfo.start();
    // sparse plucks — calm minor pentatonic, or urgent dissonance when danger is near
    const CALM = [110, 130.8, 146.8, 164.8, 196, 220];
    const TENSE = [110, 116.5, 138.6, 155.6, 185];
    const pluck = () => {
      if (!Sfx.muted) {
        const notes = this.tense ? TENSE : CALM;
        const f = notes[Math.floor(CRNG.next() * notes.length)] * (CRNG.chance(0.3) ? 2 : 1);
        const t0 = c.currentTime;
        const o = c.createOscillator(), g = c.createGain();
        o.type = 'triangle'; o.frequency.value = f;
        g.gain.setValueAtTime(this.tense ? 0.05 : 0.035, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + (this.tense ? 1.2 : 2.2));
        o.connect(g); g.connect(this.master);
        o.start(t0); o.stop(t0 + 2.3);
      }
      this.timer = setTimeout(pluck, this.tense ? 900 + CRNG.next() * 1200 : 2400 + CRNG.next() * 3600);
    };
    this.timer = setTimeout(pluck, 1200);
  },
  tense: false,
  vol: 1,
  setTension(t) { this.tense = !!t; },
  applyGain() { if (this.master) this.master.gain.value = (Sfx.muted ? 0 : 0.5) * this.vol; },
  setMuted() { this.applyGain(); },
  setVolume(v) { this.vol = clamp(v, 0, 1); this.applyGain(); },
};
