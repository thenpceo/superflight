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
