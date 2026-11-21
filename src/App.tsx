import { useEffect, useRef, useState } from 'react';
import { useApp } from './store';
import { Topbar } from './panels/Topbar';
import { Pendant } from './pendant/Pendant';
import { AgentDock, askAboutFault } from './panels/ChatPanel';
import { Viewport } from './view/Viewport';
import { Gate } from './panels/Gate';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { Splitter } from './ui/Splitter';
import { startDemo } from './study/session';
import { agentMode } from './agent/controller';
import { TourOverlay, startTour } from './tour/Tour';
import { TASKS, isMultiArm } from './content';

function Bokeh() {
  const bubbles = [[8, 70, 120, 0], [22, 18, 60, 4], [78, 12, 90, 8], [90, 64, 140, 2], [55, 85, 70, 6], [40, 6, 40, 10], [66, 40, 30, 3]];
  return <div className="bokeh" aria-hidden>{bubbles.map(([l, t, s, d], i) => <span key={i} style={{ left: `${l}%`, top: `${t}%`, width: s, height: s, animationDelay: `-${d}s` }} />)}</div>;
}

function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return <div className="toasts" role="status">{toasts.map((t) => <div key={t.id} className="toast" style={t.tone === 'bad' ? { borderColor: 'rgba(239,75,95,.35)' } : t.tone === 'good' ? { borderColor: 'rgba(47,184,74,.4)' } : undefined}>{t.text}</div>)}</div>;
}

export function App() {
  const params = new URLSearchParams(location.search);
  const urlCode = params.get('code') ?? '';
  const wantsStudy = !!urlCode || params.has('study');
  const [gated, setGated] = useState(wantsStudy);
  const mode = useApp((s) => s.mode);
  const taskId = useApp((s) => s.taskId);
  const study = useApp((s) => s.study);
  const [booted, setBooted] = useState(false);
  const stageRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!wantsStudy) {
      const t = params.get('demo') ?? params.get('task') ?? '';
      startDemo(TASKS[t] ? t : undefined);
      if (params.has('tour')) startTour();
    }
    setBooted(true);
  }, []);  

  if (gated) return (<><Bokeh /><Gate initialCode={urlCode} onDone={() => setGated(false)} /><Toasts /><MobileBlock /></>);
  if (!booted || !taskId) return null;
  const am = agentMode();
  void mode; void study;
  return (
    <>
      <Bokeh />
      <div className="app">
        <Topbar />
        <main className="stage" ref={stageRef}>
          <ErrorBoundary label="cell view"><Viewport onAskAgent={am !== 'off' ? askAboutFault : undefined} /></ErrorBoundary>
          <Splitter stage={stageRef} wide={!!TASKS[taskId] && isMultiArm(TASKS[taskId])} />
          <ErrorBoundary label="teach pendant"><Pendant /></ErrorBoundary>
        </main>
      </div>
      {am !== 'off' && <ErrorBoundary label="AI partner" compact><AgentDock /></ErrorBoundary>}
      <ErrorBoundary label="tour" compact><TourOverlay /></ErrorBoundary>
      <Toasts />
      <MobileBlock />
    </>
  );
}

function MobileBlock() {
  return (
    <div className="mobile-block">
      <div className="glass gate-card">
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" />
        <h1>Tandem</h1>
        <p>Tandem needs a larger screen. Please open it on a desktop or laptop browser (Chrome, Edge or Firefox).</p>
      </div>
    </div>
  );
}
