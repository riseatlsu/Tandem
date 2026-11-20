/**
 * Demo-mode background music.
 * If a royalty-free track is placed at public/music/theme.mp3 (or .ogg), it loops.
 * Otherwise Tandem plays its own generative ambient piece, synthesized live: airy maj9 pads,
 * a soft sub bass, glassy pentatonic bells through a ping-pong delay and a gentle shaker —
 * bright and calm, in the spirit of mid-2000s "Aero" UI music. No files, no licensing.
 */
import { sound } from './sound';

const BPM = 84;
const STEP = 60 / BPM / 4; // 16th note
// chords as MIDI notes (D major colour): Dmaj9, Bm9, Gmaj9(#11), A6sus
const CHORDS = [
  { root: 38, pad: [62, 66, 69, 73, 76] },
  { root: 35, pad: [59, 62, 66, 69, 73] },
  { root: 31, pad: [59, 62, 66, 67, 73] },
  { root: 33, pad: [57, 62, 64, 66, 71] },
];
const BELLS = [74, 76, 78, 81, 83, 86, 88, 90]; // D major pentatonic, upper register
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

class Music {
  private playing = false;
  private out: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextTime = 0;
  private step = 0;
  private seed = 7;
  private reverb: ConvolverNode | null = null;
  private delay: { input: GainNode } | null = null;
  private track: HTMLAudioElement | null = null;
  private trackChecked = false;
  private trackUrl: string | null = null;

  private rand() { this.seed = (this.seed * 16807) % 2147483647; return this.seed / 2147483647; }

  async start() {
    const ctx = sound.ctx;
    if (!ctx || this.playing) return;
    this.playing = true;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(sound.musicBus);
    this.out.gain.setTargetAtTime(0.55, ctx.currentTime, 1.2);

    if (!this.trackChecked) { this.trackChecked = true; this.trackUrl = await findTrack(); }
    if (!this.playing) return;
    if (this.trackUrl) {
      if (!this.track) {
        this.track = new Audio(this.trackUrl);
        this.track.loop = true;
        this.track.crossOrigin = 'anonymous';
        ctx.createMediaElementSource(this.track).connect(this.out);
      }
      void this.track.play().catch(() => { /* blocked until gesture */ });
      return;
    }
    this.buildFx();
    this.nextTime = ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 90);
  }

  stop() {
    const ctx = sound.ctx;
    if (!ctx || !this.playing) return;
    this.playing = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const out = this.out;
    out?.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
    const tr = this.track;
    setTimeout(() => { out?.disconnect(); if (tr && !this.playing) tr.pause(); }, 2000);
    this.out = null;
  }

  get isPlaying() { return this.playing; }

  private buildFx() {
    const ctx = sound.ctx!;
    // reverb: synthetic 3.2 s impulse response
    const len = Math.floor(ctx.sampleRate * 3.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (this.rand() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.55;
    this.reverb.connect(wet).connect(this.out!);
    // ping-pong delay for the bells (dotted 8th)
    const input = ctx.createGain();
    const l = ctx.createDelay(2), r = ctx.createDelay(2);
    l.delayTime.value = r.delayTime.value = STEP * 3;
    const fb = ctx.createGain(); fb.gain.value = 0.38;
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 3500;
    const merger = ctx.createChannelMerger(2);
    input.connect(l); l.connect(tone).connect(r); r.connect(fb).connect(l);
    l.connect(merger, 0, 0); r.connect(merger, 0, 1);
    const dGain = ctx.createGain(); dGain.gain.value = 0.35;
    merger.connect(dGain); dGain.connect(this.out!); dGain.connect(this.reverb);
    this.delay = { input };
  }

  private schedule() {
    const ctx = sound.ctx;
    if (!ctx || !this.out) return;
    while (this.nextTime < ctx.currentTime + 0.35) {
      this.playStep(this.step, this.nextTime);
      this.step++;
      this.nextTime += STEP;
    }
  }

  private playStep(step: number, t: number) {
    const bar = Math.floor(step / 16);
    const inBar = step % 16;
    const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length];
    const chordStart = inBar === 0 && bar % 2 === 0;
    if (chordStart) chord.pad.forEach((n, i) => this.pad(midi(n), t, STEP * 32, i));
    if (inBar === 0 || inBar === 8) this.bass(midi(chord.root + 12), t, STEP * 7);
    if (inBar === 10 && this.rand() < 0.5) this.bass(midi(chord.root + 19), t, STEP * 5, 0.05);
    // bells: sparse, mostly on 8ths, denser every 4th bar
    const dense = bar % 4 === 3;
    if (inBar % 2 === 0 && this.rand() < (dense ? 0.55 : 0.28)) {
      const pool = BELLS.filter((n) => chord.pad.some((p) => (n - p) % 12 === 0) || this.rand() < 0.35);
      const n = pool[Math.floor(this.rand() * pool.length)] ?? BELLS[0];
      this.bell(midi(n), t, (this.rand() - 0.5) * 0.8);
    }
    // shaker on off-beats after the intro
    if (bar >= 2 && inBar % 4 === 2) this.shaker(t, inBar === 6 || inBar === 14 ? 0.03 : 0.018);
  }

  private pad(f: number, t: number, dur: number, i: number) {
    const ctx = sound.ctx!;
    const g = ctx.createGain();
    const filt = ctx.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.setValueAtTime(900, t);
    filt.frequency.linearRampToValueAtTime(2200, t + dur * 0.5); filt.frequency.linearRampToValueAtTime(1000, t + dur);
    const pan = ctx.createStereoPanner(); pan.pan.value = (i % 2 ? 1 : -1) * 0.35;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.035, t + 1.6);
    g.gain.setValueAtTime(0.035, t + dur - 1.2);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 1.5);
    [-6, 6].forEach((det, k) => {
      const o = ctx.createOscillator(); o.type = k ? 'triangle' : 'sine'; o.frequency.value = f; o.detune.value = det;
      o.connect(filt); o.start(t); o.stop(t + dur + 1.6);
    });
    filt.connect(g).connect(pan);
    pan.connect(this.out!); pan.connect(this.reverb!);
  }

  private bass(f: number, t: number, dur: number, level = 0.09) {
    const ctx = sound.ctx!;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f / 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(level, t + 0.04); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out!); o.start(t); o.stop(t + dur + 0.05);
  }

  private bell(f: number, t: number, panV: number) {
    const ctx = sound.ctx!;
    const g = ctx.createGain(); const pan = ctx.createStereoPanner(); pan.pan.value = panV;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.05, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    [1, 2.01, 3.98].forEach((m, k) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * m;
      const pg = ctx.createGain(); pg.gain.value = [1, 0.25, 0.07][k];
      o.connect(pg).connect(g); o.start(t); o.stop(t + 1.7);
    });
    g.connect(pan); pan.connect(this.out!); pan.connect(this.delay!.input); pan.connect(this.reverb!);
  }

  private shaker(t: number, level: number) {
    const ctx = sound.ctx!;
    const src = ctx.createBufferSource();
    const len = Math.floor(ctx.sampleRate * 0.08);
    const b = ctx.createBuffer(1, len, ctx.sampleRate); const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (this.rand() * 2 - 1) * (1 - i / len);
    src.buffer = b;
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
    const g = ctx.createGain(); g.gain.value = level;
    src.connect(f).connect(g).connect(this.out!); src.start(t);
  }
}

/** Look for an optional bundled track (the dev server answers unknown paths with index.html, so check the type). */
async function findTrack(): Promise<string | null> {
  for (const ext of ['mp3', 'ogg']) {
    const url = `${import.meta.env.BASE_URL}music/theme.${ext}`;
    try {
      const r = await fetch(url, { method: 'HEAD' });
      if (r.ok && (r.headers.get('content-type') ?? '').startsWith('audio')) return url;
    } catch { /* not present */ }
  }
  return null;
}

export const music = new Music();

/** Follow `shouldPlay` (demo + music preference, or the landing page's own toggle), starting after the first gesture. */
export function initMusic(shouldPlay: () => boolean) {
  const sync = () => {
    if (!sound.ctx) return;
    if (shouldPlay()) void music.start();
    else music.stop();
  };
  sound.on(sync);
  addEventListener('pointerdown', () => setTimeout(sync, 0), { capture: true });
  return sync;
}
