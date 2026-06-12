/**
 * Procedural wind — filtered noise whose volume/brightness follows speed,
 * plus a low rumble layer that swells during boost. No audio files needed.
 */
export class WindAudio {
  constructor() {
    this.started = false;
  }

  start() {
    if (this.started) return;
    this.started = true;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;

    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02; // pinkish
      data[i] = last * 3.5;
    }

    const makeLayer = (type, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      const filt = ctx.createBiquadFilter();
      filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
      const gain = ctx.createGain(); gain.gain.value = 0;
      src.connect(filt).connect(gain).connect(ctx.destination);
      src.start(Math.random());
      return { filt, gain };
    };

    this.hiss = makeLayer('bandpass', 600, 0.6);   // air rushing past ears
    this.rumble = makeLayer('lowpass', 110, 0.8);  // boost pressure-wave
  }

  update(state) {
    if (!this.started) return;
    const s = state.speed01;
    const t = this.ctx.currentTime;
    this.hiss.gain.gain.setTargetAtTime(0.03 + s * s * 0.34, t, 0.12);
    this.hiss.filt.frequency.setTargetAtTime(380 + s * 1400, t, 0.15);
    this.rumble.gain.gain.setTargetAtTime(state.boost01 * 0.5 + state.justBoosted * 0.25, t, 0.1);
  }
}

/**
 * Procedural combat SFX sharing the wind's AudioContext.
 * Laser: detuned saw hum + noise sizzle. Boom: filtered noise burst.
 * Punch: short low thud.
 */
export class SFX {
  constructor(wind) { this.wind = wind; this._laserOn = false; }
  get ctx() { return this.wind.ctx; }

  _ensureLaser() {
    if (this._laser) return;
    const ctx = this.ctx;
    const gain = ctx.createGain(); gain.gain.value = 0;
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 88;
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth'; o2.frequency.value = 92.5;
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 900;
    o1.connect(filt); o2.connect(filt); filt.connect(gain).connect(ctx.destination);
    o1.start(); o2.start();
    this._laser = { gain, o1 };
  }

  laser(on) {
    if (!this.ctx) return;
    this._ensureLaser();
    if (on === this._laserOn) {
      if (on) this._laser.o1.frequency.setValueAtTime(86 + Math.random() * 6, this.ctx.currentTime);
      return;
    }
    this._laserOn = on;
    this._laser.gain.gain.setTargetAtTime(on ? 0.16 : 0, this.ctx.currentTime, 0.05);
  }

  _noiseBurst(dur, freq, gainV, type = 'lowpass') {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 1.6;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const filt = ctx.createBiquadFilter(); filt.type = type; filt.frequency.value = freq;
    const g = ctx.createGain(); g.gain.value = gainV;
    src.connect(filt).connect(g).connect(ctx.destination);
    src.start();
  }

  boom() { this._noiseBurst(0.7, 220, 0.8); }
  punch() { this._noiseBurst(0.16, 350, 0.9); this._noiseBurst(0.4, 120, 0.6); }
  whoosh() { this._noiseBurst(0.5, 1200, 0.25, 'bandpass'); }
}
