/**
 * Tandem sound design — everything is synthesized with WebAudio (no audio files, no licensing).
 * - UI: soft glassy taps for buttons, pops for navigation.
 * - Robot: a servo hum whose pitch and level follow joint speed, gripper whirs, grasp clunks.
 * - Events: run start/stop, teach chime, success arpeggio, protective-stop alarm, AI reply bubble.
 * The AudioContext is created on the first user gesture (browser autoplay rules).
 */
import { useApp } from '../store';

const KEY = 'tandem.sound';
export interface SoundPrefs { sfx: boolean; music: boolean; volume: number }
function loadPrefs(): SoundPrefs {
  try { const p = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (p && typeof p.sfx === 'boolean') return { sfx: p.sfx, music: p.music !== false, volume: typeof p.volume === 'number' ? p.volume : 0.8 }; } catch { /* storage unavailable */ }
  return { sfx: true, music: true, volume: 0.8 };
}

type Listener = (p: SoundPrefs) => void;
class SoundEngine {
  prefs: SoundPrefs = loadPrefs();
  ctx: AudioContext | null = null;
  master!: GainNode;
  sfxBus!: GainNode;
  musicBus!: GainNode;
  private listeners = new Set<Listener>();
  private hum: { osc: OscillatorNode[]; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private belt: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private noise: AudioBuffer | null = null;
  private lastTap = 0;

  /** Create the audio graph (call from a user gesture). */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.prefs.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.15;
    const makeup = ctx.createGain(); makeup.gain.value = 2.6; // synth voices are scaled conservatively; bring them up before the compressor
    this.master.connect(makeup).connect(comp).connect(ctx.destination);
    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = this.prefs.sfx ? 1 : 0; this.sfxBus.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 1; this.musicBus.connect(this.master);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < len; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; d[i] = (seed / 0x7fffffff) * 2 - 1; }
    this.emit();
  }

  on(fn: Listener) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private emit() { this.listeners.forEach((f) => f(this.prefs)); }
  set(p: Partial<SoundPrefs>) {
    this.prefs = { ...this.prefs, ...p };
    try { localStorage.setItem(KEY, JSON.stringify(this.prefs)); } catch { /* storage unavailable */ }
    if (this.ctx) {
      const t = this.ctx.currentTime;
      this.sfxBus.gain.setTargetAtTime(this.prefs.sfx ? 1 : 0, t, 0.05);
      this.master.gain.setTargetAtTime(this.prefs.volume, t, 0.05);
      if (!this.prefs.sfx) this.motion(0, false);
    }
    this.emit();
  }
  private ok() { return !!this.ctx && this.prefs.sfx && this.ctx.state === 'running'; }

  // ---------------------------------------------------------------- primitives
  private tone(freq: number, dur: number, { type = 'sine' as OscillatorType, gain = 0.2, attack = 0.005, at = 0, glide = 0, pan = 0 } = {}) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * glide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    o.connect(g).connect(p).connect(this.sfxBus);
    o.start(t); o.stop(t + dur + 0.05);
  }
  private burst(dur: number, { freq = 2000, q = 1, gain = 0.15, at = 0, type = 'bandpass' as BiquadFilterType, sweep = 0 } = {}) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, Math.random()); src.stop(t + dur + 0.02);
  }

  // ---------------------------------------------------------------- UI
  tap() {
    if (!this.ok()) return;
    const now = performance.now(); if (now - this.lastTap < 40) return; this.lastTap = now;
    this.tone(1650, 0.05, { gain: 0.07, type: 'triangle' });
    this.burst(0.03, { freq: 4200, q: 2, gain: 0.05 });
  }
  pop() { if (!this.ok()) return; this.tone(520, 0.09, { gain: 0.09, glide: 1.9 }); }
  toggle(on: boolean) { if (!this.ok()) return; this.tone(on ? 880 : 660, 0.08, { gain: 0.08, type: 'triangle' }); this.tone(on ? 1320 : 440, 0.1, { gain: 0.06, type: 'triangle', at: 0.05 }); }
  jogStep() { if (!this.ok()) return; this.tone(240, 0.06, { gain: 0.05, type: 'square', glide: 1.4 }); }
  error() { if (!this.ok()) return; this.tone(330, 0.14, { gain: 0.09, type: 'triangle' }); this.tone(247, 0.2, { gain: 0.09, type: 'triangle', at: 0.11 }); }

  // ---------------------------------------------------------------- program events
  runStart() { if (!this.ok()) return; [523, 659, 784].forEach((f, i) => this.tone(f, 0.18, { gain: 0.08, type: 'triangle', at: i * 0.06 })); }
  runStop() { if (!this.ok()) return; this.tone(587, 0.16, { gain: 0.08, type: 'triangle' }); this.tone(392, 0.24, { gain: 0.08, type: 'triangle', at: 0.09 }); }
  pause() { if (!this.ok()) return; this.tone(494, 0.12, { gain: 0.07, type: 'triangle' }); this.tone(494, 0.12, { gain: 0.06, type: 'triangle', at: 0.13 }); }
  teach() { if (!this.ok()) return; this.tone(1047, 0.35, { gain: 0.1 }); this.tone(1568, 0.5, { gain: 0.08, at: 0.08 }); this.burst(0.06, { freq: 6000, q: 3, gain: 0.03 }); }
  success() {
    if (!this.ok()) return;
    [523, 659, 784, 1047, 1319].forEach((f, i) => { this.tone(f, 0.7, { gain: 0.09, at: i * 0.09 }); this.tone(f * 2, 0.4, { gain: 0.025, at: i * 0.09 + 0.01 }); });
    this.burst(0.5, { freq: 8000, q: 0.7, gain: 0.03, at: 0.35, type: 'highpass' });
  }
  fault() {
    if (!this.ok()) return;
    for (let i = 0; i < 3; i++) { this.tone(880, 0.13, { gain: 0.08, type: 'square', at: i * 0.26 }); this.tone(660, 0.13, { gain: 0.08, type: 'square', at: i * 0.26 + 0.13 }); }
    this.burst(0.25, { freq: 180, q: 0.8, gain: 0.12, type: 'lowpass' });
  }
  agentReply() { if (!this.ok()) return; this.tone(988, 0.12, { gain: 0.06, glide: 1.3 }); this.tone(1480, 0.18, { gain: 0.05, at: 0.07, glide: 1.2 }); }
  proposal() { if (!this.ok()) return; [784, 988, 1175].forEach((f, i) => this.tone(f, 0.25, { gain: 0.06, at: i * 0.07 })); }

  // ---------------------------------------------------------------- robot
  gripper(close: boolean) {
    if (!this.ok()) return;
    this.tone(close ? 520 : 300, 0.22, { gain: 0.05, type: 'sawtooth', glide: close ? 0.55 : 1.8 });
    this.burst(0.2, { freq: close ? 2500 : 1500, q: 4, gain: 0.04, sweep: close ? 0.5 : 1.8 });
    if (close) this.burst(0.05, { freq: 900, q: 2, gain: 0.12, at: 0.2 });
  }
  grasp() { if (!this.ok()) return; this.tone(140, 0.12, { gain: 0.14, type: 'triangle' }); this.burst(0.06, { freq: 1200, q: 1.5, gain: 0.08 }); }
  release() { if (!this.ok()) return; this.burst(0.08, { freq: 700, q: 1.2, gain: 0.08, at: 0.05 }); }

  /** Continuous servo hum. speed: rad/s of the fastest joint. */
  motion(speed: number, beltRunning: boolean) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    if (!this.hum && this.prefs.sfx && ctx.state === 'running' && speed > 0.01) {
      const gain = ctx.createGain(); gain.gain.value = 0;
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 600; filter.Q.value = 3;
      const osc = [0, 7, -5].map((det, i) => { const o = ctx.createOscillator(); o.type = i === 0 ? 'sawtooth' : 'triangle'; o.detune.value = det; o.frequency.value = 110; o.connect(filter); o.start(); return o; });
      filter.connect(gain).connect(this.sfxBus);
      this.hum = { osc, gain, filter };
    }
    if (this.hum) {
      const s = Math.min(1, speed / 1.6);
      const level = speed > 0.01 && this.prefs.sfx ? 0.012 + s * 0.05 : 0;
      this.hum.gain.gain.setTargetAtTime(level, t, 0.06);
      const f = 95 + s * 170;
      this.hum.osc.forEach((o, i) => o.frequency.setTargetAtTime(i === 2 ? f / 2 : f, t, 0.08));
      this.hum.filter.frequency.setTargetAtTime(400 + s * 1600, t, 0.08);
    }
    // conveyor rumble
    if (beltRunning && this.prefs.sfx && ctx.state === 'running' && !this.belt) {
      const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220;
      const gain = ctx.createGain(); gain.gain.value = 0; gain.gain.setTargetAtTime(0.05, t, 0.2);
      src.connect(f).connect(gain).connect(this.sfxBus); src.start();
      this.belt = { src, gain };
    } else if ((!beltRunning || !this.prefs.sfx) && this.belt) {
      const b = this.belt; this.belt = null;
      b.gain.gain.setTargetAtTime(0, t, 0.15); b.src.stop(t + 0.8);
    }
  }
}

export const sound = new SoundEngine();

/** Wire global UI taps and store-driven event sounds. Call once at startup. */
export function initSound() {
  const unlock = () => sound.unlock();
  addEventListener('pointerdown', unlock, { capture: true });
  addEventListener('keydown', unlock, { capture: true });
  // every button press gets a soft glassy tap (specific events layer their own sound on top)
  addEventListener('pointerdown', (e) => {
    const el = (e.target as HTMLElement | null)?.closest?.('button, select, [role="slider"], input[type="checkbox"]') as HTMLElement | null;
    if (!el || (el as HTMLButtonElement).disabled) return;
    if (el.matches('.hw-key.run, .estop')) return;
    if (el.matches('.pd-dock button, .app-tile, .task-card, .pd-back, .bubble')) sound.pop();
    else if (el.matches('[role="slider"]')) sound.jogStep();
    else sound.tap();
  }, { capture: true });

  useApp.subscribe((s, prev) => {
    if (s.taskId !== prev.taskId || s.armOverride !== prev.armOverride) resetSoundFrame();
    if (s.runState !== prev.runState) {
      if (prev.runState === 'idle' && s.runState === 'running') sound.runStart();
      else if (s.runState === 'paused') sound.pause();
      else if (s.runState === 'idle' && !s.fault) sound.runStop();
    }
    if (s.fault && s.fault !== prev.fault) sound.fault();
    if (s.showSuccess && !prev.showSuccess) sound.success();
    if (s.handGuide !== prev.handGuide) sound.toggle(s.handGuide);
    if (s.agentOpen !== prev.agentOpen) sound.toggle(s.agentOpen);
    const t = s.workspaces[s.taskId]?.targets, pt = prev.workspaces[prev.taskId]?.targets;
    if (t && pt && s.taskId === prev.taskId && t !== pt) {
      const changed = Object.keys(t).length > Object.keys(pt).length || Object.entries(t).some(([k, v]) => pt[k] && pt[k].pose !== v.pose);
      if (changed) sound.teach();
    }
    const msgs = s.chats[s.taskId], pm = prev.chats[prev.taskId];
    if (msgs && pm && msgs.length > pm.length) {
      const last = msgs[msgs.length - 1];
      if (last.role === 'proposal') sound.proposal();
      else if (last.role === 'error') sound.error();
    }
    if (s.agentBusy === false && prev.agentBusy === true) sound.agentReply();
    if (s.toasts.length > prev.toasts.length && s.toasts[s.toasts.length - 1].tone === 'bad') sound.error();
  });
}

/** Called from the render loop with the live sim state. */
let lastQ: number[] | null = null, lastT = 0, lastSpeed = 0, lastGrip: boolean | null = null, lastHold: string | null = null, sinceStill = 0;
export function soundFrame(q: number[], gripperOpen: boolean, holding: string | null, beltRunning: boolean) {
  const now = performance.now();
  let speed = 0;
  if (lastQ && lastQ.length === q.length && now > lastT) {
    const dt = (now - lastT) / 1000;
    for (let i = 0; i < q.length; i++) speed = Math.max(speed, Math.abs(q[i] - lastQ[i]) / dt);
  }
  if (speed > 6) speed = 0; // teleport (task load / reset), not motion
  // hold the last speed through single-frame stalls so the hum doesn't flicker
  if (speed < 0.01) sinceStill += now - lastT; else sinceStill = 0;
  const eff = speed >= 0.01 ? speed : sinceStill > 120 ? 0 : lastSpeed;
  lastSpeed = eff; lastQ = q.slice(); lastT = now;
  sound.motion(eff, beltRunning);
  if (lastGrip !== null && gripperOpen !== lastGrip) sound.gripper(!gripperOpen);
  if (holding !== lastHold) { if (holding && lastHold === null && lastGrip !== null) sound.grasp(); else if (!holding && lastHold) sound.release(); }
  lastGrip = gripperOpen; lastHold = holding;
}
export function resetSoundFrame() { lastQ = null; lastGrip = null; lastHold = null; lastSpeed = 0; }
