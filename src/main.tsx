import { Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/theme.css';

// No StrictMode: effects here own imperative resources (WebGL, Blockly, workers) and one-shot study redemption.
import { initSound, sound } from './audio/sound';
import { initMusic } from './audio/music';
import { useApp } from './store';
import { initPlanTracking } from './agent/plans';
import { host } from './simHost';
import { programSource } from './editor/program';

const App = lazy(() => import('./App').then((m) => ({ default: m.App })));
const Landing = lazy(() => import('./landing/Landing'));
// The content editor only exists on the dev server (it writes into the repo); production builds drop it.
const Studio = import.meta.env.DEV ? lazy(() => import('./studio/Studio')) : null;

function boot() {
  // Routing: ?code= / ?study → study gate; ?demo[=taskId][&tour] → the app; anything else → the landing page.
  const params = new URLSearchParams(location.search);
  const editor = params.has('editor');
  const route = params.has('code') || params.has('study') || params.has('demo') || params.has('tour') ? 'app' : 'landing';
  useApp.getState().set({ route: editor ? 'landing' : route }); // 'landing' keeps music off in the editor unless toggled

  initSound();
  initPlanTracking(host, programSource);
  const syncMusic = initMusic(() => {
    const s = useApp.getState();
    return s.route === 'landing' ? s.landingMusic : s.mode === 'demo' && sound.prefs.music;
  });
  useApp.subscribe((s, p) => { if (s.mode !== p.mode || s.route !== p.route || s.landingMusic !== p.landingMusic) syncMusic(); });

  function Splash() {
    return <div className="splash" aria-busy="true"><img src={`${import.meta.env.BASE_URL}logo.svg`} alt="Tandem" /></div>;
  }
  function NoStudio() {
    return <div className="splash"><div className="glass" style={{ padding: 28, borderRadius: 20, maxWidth: 460, textAlign: 'center' }}><h2>Tandem Studio runs locally</h2><p>Start the dev server (<code>VITE_BASE=/ npm run dev</code>) and open <code>localhost:5173/?editor</code>.</p></div></div>;
  }
  const page = editor ? (Studio ? <Studio /> : <NoStudio />) : route === 'app' ? <App /> : <Landing />;
  createRoot(document.getElementById('root')!).render(<Suspense fallback={<Splash />}>{page}</Suspense>);

}

// Content edits (e.g. saved from Tandem Studio) can re-run this entry module through HMR.
// Booting twice would create a second React root and duplicate listeners, so reload the page instead.
const hot = import.meta.hot;
const rerun = !!hot?.data.booted;
if (hot) hot.data.booted = true;
if (rerun) location.reload();
else boot();

if (import.meta.env.DEV || import.meta.env.VITE_E2E === 'true') {
  void Promise.all([import('./store'), import('./simHost'), import('./editor/program'), import('./blocks/steps'), import('./study/logger'), import('./audio/sound'), import('./audio/music'), import('./tour/Tour'), import('./view/ghost')]).then(([store, sh, prog, steps, logger, snd, mus, tour, ghost]) => {
    const w = window as unknown as Record<string, unknown>;
    w.__tandem = { useApp: store.useApp, host: sh.host, programSource: prog.programSource, updateWorkspace: store.updateWorkspace, flushLogs: logger.flush, sound: snd.sound, music: mus.music, endTour: tour.endTour, playGhost: ghost.playGhost };
    w.__tandemSetSteps = (s: Parameters<typeof steps.stepsToWorkspaceJson>[0]) => store.updateWorkspace({ blocks: { ...steps.stepsToWorkspaceJson(s), __external: true } });
  });
}
