// DUSTLINE — all sound is synthesised with WebAudio. No audio files, no network.
// One job: every bang, click, beep and footstep the game needs.

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.muted = false;
  }

  // Must be called from a user gesture (click / key) — browsers gate AudioContext.
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    // 1 second of white noise, reused by every noise-based sound.
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  // Volume (0-1) and stereo pan (-1 left, +1 right) for a sound at a world
  // position relative to the listener. Returns {gain, pan}.
  spatial(ox, oz, lx, lz, yaw, maxDist = 55) {
    const dx = ox - lx, dz = oz - lz;
    const dist = Math.hypot(dx, dz);
    const gain = Math.max(0, 1 - dist / maxDist);
    // pan by the angle between the listener's facing and the source
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = -fz, rz = fx;
    const pan = Math.max(-1, Math.min(1, (dx * rx + dz * rz) / Math.max(1, dist)));
    return { gain, pan };
  }

  _noise(dur, filterType, freq, q, gain, pan = 0, when = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const flt = this.ctx.createBiquadFilter();
    flt.type = filterType; flt.frequency.value = freq; flt.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(flt); flt.connect(g); g.connect(p); p.connect(this.master);
    src.start(t); src.stop(t + dur + 0.05);
  }

  _tone(freq, dur, type, gain, slideTo = 0, pan = 0, when = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo > 0) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(g); g.connect(p); p.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  shot(pitch = 1, gain = 0.5, pan = 0) {
    this._noise(0.09, 'lowpass', 2600 * pitch, 0.8, gain, pan);
    this._tone(150 * pitch, 0.08, 'square', gain * 0.35, 60 * pitch, pan);
  }

  dryFire() { this._tone(1400, 0.03, 'square', 0.12); }

  reload() {
    this._tone(900, 0.04, 'square', 0.1);
    this._tone(620, 0.05, 'square', 0.12, 0, 0, 0.18);
    this._tone(1100, 0.04, 'square', 0.14, 0, 0, 0.42);
  }

  step(run, pan = 0) {
    this._noise(0.06, 'lowpass', run ? 900 : 500, 0.7, run ? 0.10 : 0.06, pan);
  }

  hit(head = false) {
    this._tone(head ? 2400 : 1500, 0.05, 'sine', 0.22, head ? 1800 : 1100);
  }

  hurt() {
    this._tone(180, 0.14, 'sawtooth', 0.2, 90);
    this._noise(0.12, 'lowpass', 700, 1, 0.18);
  }

  explosion(gain = 0.9, pan = 0) {
    this._noise(0.9, 'lowpass', 900, 0.6, gain, pan);
    this._tone(70, 0.8, 'sine', gain * 0.8, 28, pan);
  }

  grenadeThrow() { this._noise(0.15, 'bandpass', 1200, 2, 0.12); }
  grenadeBounce() { this._tone(320, 0.06, 'triangle', 0.15, 180); }

  beep(final = false) {
    this._tone(final ? 1320 : 990, final ? 0.28 : 0.09, 'square', 0.16);
  }

  plantTick() { this._tone(1150, 0.05, 'square', 0.12); }

  roundWin() {
    [523, 659, 784].forEach((f, i) => this._tone(f, 0.22, 'triangle', 0.2, 0, 0, i * 0.13));
  }

  roundLose() {
    [392, 330, 262].forEach((f, i) => this._tone(f, 0.25, 'triangle', 0.18, 0, 0, i * 0.15));
  }

  buy() { this._tone(880, 0.07, 'sine', 0.16); this._tone(1320, 0.1, 'sine', 0.14, 0, 0, 0.07); }
  denied() { this._tone(220, 0.12, 'square', 0.14, 160); }
  click() { this._tone(1000, 0.03, 'square', 0.08); }
}
