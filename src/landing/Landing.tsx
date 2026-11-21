/** Tandem's landing page: a game-style showcase in the platform's Frutiger Aero look. */
import { useEffect, useRef, useState } from 'react';
import { HeroCell } from './HeroCell';
import { RobotLineup } from './RobotLineup';
import { TASKS, DEMO_TASKS, SCENES } from '../content';
import { clipUrl } from '../agent/clips';
import { useApp } from '../store';
import { sound } from '../audio/sound';
import { Icon } from '../ui/icons';
import './landing.css';

const BASE = import.meta.env.BASE_URL;
const demoUrl = (task?: string, tour = false) => `${BASE}?demo${task ? `=${task}` : ''}${tour ? '&tour' : ''}`;

const FEATURES = [
  { clip: 'jog-joystick', eyebrow: 'Teach pendant', title: 'Drive it like the real thing', text: 'A handheld-style teach pendant with a proportional joystick, axis and linear jog modes, taught positions and hand guiding — the same workflow used on factory floors.', points: ['Joystick + step jogging', 'Teach and re-teach positions', 'Hand-guide the arm in 3D'] },
  { clip: 'build-blocks', eyebrow: 'Blocks or code', title: 'Start with blocks, grow into code', text: 'Snap together Wizard-style blocks, or write JavaScript with a full code editor. Both drive the same robot API, so skills carry straight over.', points: ['Beginner-friendly blocks', 'JavaScript with autocomplete', 'Step through line by line'] },
  { clip: 'ai-suggestion', eyebrow: 'AI partner', title: 'A partner that shows you how', text: 'Ask anything. Your AI partner reads your program and the robot, draws the blocks you need, plays example clips, makes a checklist that ticks itself off, and previews its suggestions on a ghost robot.', points: ['Pictures of blocks in chat', 'Step-by-step plans', 'Ghost-robot previews'] },
  { clip: 'fault-recover', eyebrow: 'Real simulation', title: 'Safe to break, honest about why', text: 'Every motion is checked for reach, joint limits, singularities and collisions before the arm moves. Mistakes stop the program and point at the exact block.', points: ['Collision and reach checks', 'Conveyors, sensors and liquids', 'Deterministic replays'] },
];

const ENV_LABEL: Record<string, string> = { factory: 'Factory', warehouse: 'Warehouse', kitchen: 'Kitchen & lab', lab: 'Lab', custom: 'Custom' };

/** Adds `.in` to elements with `.reveal` as they scroll into view. */
function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll('.reveal');
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: 0.18 });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
}

function MusicButton() {
  const on = useApp((s) => s.landingMusic);
  return (
    <button className={`round-btn ${on ? 'on' : ''}`} aria-pressed={on} aria-label={on ? 'Turn music off' : 'Turn music on'} title={on ? 'Music on' : 'Play music'}
      onClick={() => { sound.unlock(); if (!on && !sound.prefs.music) sound.set({ music: true }); useApp.getState().set({ landingMusic: !on }); }}>
      <Icon.music width={16} height={16} />{!on && <i className="slash" />}
    </button>
  );
}

function Bubbles() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const x = e.clientX / innerWidth - 0.5, y = e.clientY / innerHeight - 0.5;
      ref.current?.style.setProperty('--mx', String(x)); ref.current?.style.setProperty('--my', String(y));
    };
    addEventListener('pointermove', move);
    return () => removeEventListener('pointermove', move);
  }, []);
  const b = [[6, 72, 90, 1.4, 0], [14, 22, 46, 2.2, 3], [30, 82, 28, 3, 6], [44, 12, 64, 1.1, 2], [58, 76, 36, 2.6, 8], [72, 18, 110, 0.8, 4], [86, 60, 52, 1.8, 1], [93, 28, 24, 3.2, 7], [22, 50, 18, 3.6, 5], [66, 44, 20, 3.4, 9]];
  return (
    <div className="l-bubbles" ref={ref} aria-hidden>
      {b.map(([l, t, s, depth, d], i) => <span key={i} style={{ left: `${l}%`, top: `${t}%`, width: s, height: s, ['--d' as string]: depth, animationDelay: `-${d}s` }} />)}
    </div>
  );
}

export default function Landing() {
  useReveal();
  const [scene, setScene] = useState('');
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    document.title = 'Tandem — Program cobots, together';
    document.documentElement.classList.add('is-landing');
    const f = () => setScrolled(scrollY > 24);
    addEventListener('scroll', f, { passive: true });
    return () => { removeEventListener('scroll', f); document.documentElement.classList.remove('is-landing'); };
  }, []);
  const levels = DEMO_TASKS.filter((id) => TASKS[id]);

  return (
    <div className="landing">
      <nav className={`l-nav ${scrolled ? 'solid' : ''}`} aria-label="Main">
        <a className="l-brand" href={BASE}><img src={`${BASE}logo.png`} alt="" /><span>Tandem</span></a>
        <div className="l-links">
          <a href="#features">Features</a><a href="#levels">Levels</a><a href="#robots">Robots</a>
        </div>
        <span className="grow" />
        <MusicButton />
        <a className="btn aqua" href={demoUrl()}><Icon.play width={12} height={12} /> Launch demo</a>
      </nav>

      <header className="l-hero">
        <div className="l-sky" aria-hidden><div className="l-sun" /><div className="l-rays" /></div>
        <Bubbles />
        <HeroCell onScene={setScene} />
        <svg className="l-hills" viewBox="0 0 1440 220" preserveAspectRatio="none" aria-hidden>
          <defs>
            <linearGradient id="hillA" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#a9ef7d" /><stop offset="1" stopColor="#3cb84a" /></linearGradient>
            <linearGradient id="hillB" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#d4ffb4" /><stop offset="1" stopColor="#7fd65a" /></linearGradient>
          </defs>
          <path d="M0 120 C 240 40, 480 60, 720 110 S 1200 170, 1440 80 V220 H0 Z" fill="url(#hillB)" opacity=".85" />
          <path d="M0 170 C 300 110, 620 150, 900 160 S 1300 120, 1440 140 V220 H0 Z" fill="url(#hillA)" />
          <path d="M0 170 C 300 110, 620 150, 900 160 S 1300 120, 1440 140" fill="none" stroke="rgba(255,255,255,.7)" strokeWidth="3" />
        </svg>
        <div className="l-hero-copy">
          <div className="glass l-hero-card">
            <div className="eyebrow"><span className="pulse" /> Cobot programming simulator</div>
            <h1>Program cobots,<br /><span className="grad">together.</span></h1>
            <p>Jog, teach and program collaborative robot arms right in your browser — with an AI partner by your side.</p>
            <div className="l-cta">
              <a className="btn aqua lg" href={demoUrl()}><Icon.play width={14} height={14} /> Try the demo</a>
              <a className="btn lg" href={demoUrl(undefined, true)}><Icon.flag width={14} height={14} /> Take the guided tour</a>
            </div>
            <div className="l-mini">No install · Free · Runs in Chrome, Edge and Firefox</div>
          </div>
        </div>
        {scene && <div className="l-now glass"><span className="dot" /> Live: {scene}</div>}
        <a className="l-scroll" href="#features" aria-label="Scroll to features"><Icon.down width={18} height={18} /></a>
      </header>

      <section className="l-stats" aria-label="At a glance">
        {[[String(levels.length), 'levels'], ['4', 'robot arms'], ['3', 'environments'], ['1', 'AI partner']].map(([n, l]) => (
          <div key={l} className="glass stat reveal"><b>{n}</b><span>{l}</span></div>
        ))}
      </section>

      <section id="features" className="l-section">
        <div className="l-head reveal"><div className="eyebrow">What you can do</div><h2>Everything a robot programmer uses</h2></div>
        {FEATURES.map((f, k) => (
          <article key={f.clip} className={`l-feature reveal ${k % 2 ? 'flip' : ''}`}>
            <div className="l-shot glass"><img src={clipUrl(f.clip)} alt={`${f.title} — recorded in Tandem`} loading="lazy" /><span className="shine" aria-hidden /></div>
            <div className="l-copy">
              <div className="eyebrow">{f.eyebrow}</div>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
              <ul>{f.points.map((p) => <li key={p}><Icon.check width={13} height={13} /> {p}</li>)}</ul>
            </div>
          </article>
        ))}
      </section>

      <section id="levels" className="l-section l-levels-wrap">
        <div className="l-head reveal"><div className="eyebrow">Level select</div><h2>Pick a cell and start building</h2><p>From your first jog to stacking a pallet and pouring a drink. Every level is playable in the demo.</p></div>
        <div className="l-levels">
          {levels.map((id, n) => {
            const t = TASKS[id], sc = SCENES[t.sceneId];
            return (
              <a key={id} className="l-level glass reveal" href={demoUrl(id)} style={{ transitionDelay: `${(n % 4) * 70}ms` }} aria-label={`Level ${n + 1}: ${t.title}. Play in the demo.`}>
                <div className={`l-thumb env-${sc?.environment}`}>
                  <img src={`${BASE}landing/levels/${id}.jpg`} alt="" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  <span className="l-num">{n + 1}</span>
                  <span className="l-play"><Icon.play width={16} height={16} /></span>
                </div>
                <div className="l-level-body">
                  <b>{t.title}</b>
                  <div className="row">
                    <span className="chip">{ENV_LABEL[sc?.environment ?? ''] ?? sc?.title}</span>
                    <span className={`chip ${t.editor === 'blocks' ? 'leaf' : 'aqua'}`}>{t.editor === 'blocks' ? 'Blocks' : 'Code'}</span>
                    <span className="stars" aria-label={`Difficulty ${t.difficulty ?? 2} of 3`}>{[1, 2, 3].map((s) => <i key={s} className={s <= (t.difficulty ?? 2) ? 'on' : ''} />)}</span>
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      </section>

      <section id="robots" className="l-section">
        <div className="l-head reveal"><div className="eyebrow">The lineup</div><h2>Four arms, one way to program them</h2></div>
        <div className="reveal"><RobotLineup /></div>
      </section>

      <section className="l-final reveal">
        <div className="glass l-final-card">
          <img src={`${BASE}logo.png`} alt="" />
          <h2>Ready to teach your first robot?</h2>
          <p>Start with a three-minute guided tour, or jump straight into the demo.</p>
          <div className="l-cta center">
            <a className="btn aqua lg" href={demoUrl(undefined, true)}><Icon.flag width={14} height={14} /> Take the tour</a>
            <a className="btn lg" href={demoUrl()}><Icon.play width={14} height={14} /> Open the demo</a>
          </div>
        </div>
      </section>

      <footer className="l-foot">
        <span><b>Tandem</b> · a research platform for studying how people program robots with an AI partner.</span>
        <span className="muted">Taking part in a study? Use the personal link you were given.</span>
      </footer>
    </div>
  );
}
