/**
 * Tandem Studio (?editor, dev server only): create environments, tasks, experiments and robot arms
 * with live 3D previews, and save them straight into content/ (and tests/fixtures/solutions/).
 */
import { useEffect, useState } from 'react';
import { EXPERIMENTS, SCENES, TASKS } from '../content';
import { listModels, studioAvailable } from './api';
import { SceneEditor } from './SceneEditor';
import { TaskEditor } from './TaskEditor';
import { ExperimentEditor } from './ExperimentEditor';
import { RobotsEditor } from './RobotsEditor';
import { Icon } from '../ui/icons';
import './studio.css';

type Tab = 'scenes' | 'tasks' | 'experiments' | 'robots';
const TABS: { id: Tab; label: string }[] = [{ id: 'scenes', label: 'Environments' }, { id: 'tasks', label: 'Tasks' }, { id: 'experiments', label: 'Experiments' }, { id: 'robots', label: 'Robots & models' }];
const NEW = '__new__';

export default function Studio() {
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(location.search).get('editor') as Tab) || 'scenes');
  const [sel, setSel] = useState<Record<Tab, string | null>>(() => {
    const item = new URLSearchParams(location.search).get('item');
    const t = (new URLSearchParams(location.search).get('editor') as Tab) || 'scenes';
    return { scenes: null, tasks: null, experiments: null, robots: null, [t]: item };
  });
  const [flash, setFlash] = useState<string | null>(() => { try { const m = sessionStorage.getItem('tandem.studio.saved'); sessionStorage.removeItem('tandem.studio.saved'); return m; } catch { return null; } });
  useEffect(() => { if (flash) { const t = setTimeout(() => setFlash(null), 5000); return () => clearTimeout(t); } }, [flash]);
  const [models, setModels] = useState<string[]>([]);
  const [ok, setOk] = useState<boolean | null>(null);
  const [rev, setRev] = useState(0); // remount editors after a save so they pick up the new content
  const refresh = () => listModels().then(setModels).catch(() => setModels([]));
  useEffect(() => { document.title = 'Tandem Studio'; document.documentElement.classList.add('is-studio'); studioAvailable().then(setOk); void refresh(); }, []);
  useEffect(() => {
    const u = new URL(location.href); u.searchParams.set('editor', tab);
    if (sel[tab] && sel[tab] !== NEW) u.searchParams.set('item', sel[tab]!); else u.searchParams.delete('item');
    history.replaceState(null, '', u);
  }, [tab, sel]);
  const pick = (id: string | null) => setSel((s) => ({ ...s, [tab]: id }));
  // Saving a content file reloads the page (Vite); remember what to reopen and what to say.
  const saved = (id: string, what = 'Saved') => {
    try { sessionStorage.setItem('tandem.studio.saved', `${what} — ${id}`); } catch { /* ignore */ }
    const u = new URL(location.href); u.searchParams.set('editor', tab); u.searchParams.set('item', id); history.replaceState(null, '', u);
    setTimeout(() => { setSel((s) => ({ ...s, [tab]: id })); setRev((r) => r + 1); }, 1500); // if no reload happens
  };

  if (ok === false) return <div className="st-blocked glass"><h1>Tandem Studio</h1><p>The editor saves files into the project, so it only runs on your computer:</p><pre>VITE_BASE=/ npm run dev</pre><p>then open <code>http://localhost:5173/?editor</code>.</p></div>;

  const lib: { id: string; title: string; sub?: string }[] =
    tab === 'scenes' ? Object.values(SCENES).map((s) => ({ id: s.id, title: s.title, sub: s.id }))
    : tab === 'tasks' ? Object.values(TASKS).sort((a, b) => (a.demo?.order ?? 1e9) - (b.demo?.order ?? 1e9)).map((t) => ({ id: t.id, title: t.title, sub: t.demo ? `demo #${t.demo.order} · ${SCENES[t.sceneId]?.title ?? t.sceneId}` : `study only · ${SCENES[t.sceneId]?.title ?? t.sceneId}` }))
    : tab === 'experiments' ? Object.values(EXPERIMENTS).map((e) => ({ id: e.id, title: e.id, sub: `v${e.version} · ${Object.keys(e.conditions).join(', ')}` }))
    : [];
  const cur = sel[tab];
  return (
    <div className="studio">
      <header className="st-head glass">
        <a className="st-brand" href={import.meta.env.BASE_URL}><img src={`${import.meta.env.BASE_URL}logo.png`} alt="" /> Tandem <b>Studio</b></a>
        <nav className="st-tabs" aria-label="Studio sections">{TABS.map((t) => <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>{t.label}</button>)}</nav>
        <span className="grow" />
        {flash && <span className="chip leaf">{flash}</span>}
        <button className="btn sm ghost" onClick={refresh} title="Rescan public/models"><Icon.reset width={12} height={12} /> Rescan models</button>
        <a className="btn sm" href={`${import.meta.env.BASE_URL}?demo`} target="_blank" rel="noreferrer"><Icon.play width={11} height={11} /> Open the demo</a>
      </header>
      <div className={`st-body ${tab === 'robots' ? 'no-lib' : ''}`}>
        {tab !== 'robots' && (
          <aside className="st-lib">
            <button className={`st-new ${cur === NEW ? 'on' : ''}`} onClick={() => pick(NEW)}><Icon.plus width={13} height={13} /> New {tab === 'scenes' ? 'environment' : tab === 'tasks' ? 'task' : 'experiment'}</button>
            {lib.map((x) => <button key={x.id} className={`st-lib-item ${cur === x.id ? 'on' : ''}`} onClick={() => pick(x.id)}><b>{x.title}</b>{x.sub && <small>{x.sub}</small>}</button>)}
          </aside>
        )}
        <main className="st-main">
          {tab !== 'robots' && !cur && <div className="st-empty"><h2>{TABS.find((t) => t.id === tab)!.label}</h2><p>{tab === 'scenes' ? 'An environment is the cell: tables, bins, conveyors, parts, your own 3D models, sensors and named positions. Several tasks can share one.' : tab === 'tasks' ? 'A task is what the user must do in an environment: a brief, goals, a starter program — and a reference solution that proves it can be done. Choose whether it appears in the demo.' : 'An experiment assigns tasks and AI-partner settings to each study condition. Participant codes point at it.'}</p><p>Pick one on the left to edit it, or create a new one.</p></div>}
          {tab === 'scenes' && cur && <SceneEditor key={`${cur}-${rev}`} sourceId={cur === NEW ? null : cur} models={models} onSaved={saved} />}
          {tab === 'tasks' && cur && <TaskEditor key={`${cur}-${rev}`} sourceId={cur === NEW ? null : cur} onSaved={saved} />}
          {tab === 'experiments' && cur && <ExperimentEditor key={`${cur}-${rev}`} sourceId={cur === NEW ? null : cur} onSaved={saved} />}
          {tab === 'robots' && <RobotsEditor key={rev} models={models} onSaved={(id) => saved(id, 'Saved arm')} />}
        </main>
      </div>
    </div>
  );
}
