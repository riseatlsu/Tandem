/** Studio: build an experiment — conditions, AI mode/model/features, task sequences, counterbalancing, survey link — and issue participant codes. */
import { useEffect, useState } from 'react';
import { EXPERIMENTS, ExperimentZ, TASKS, type ExperimentDef } from '../content';
import { PROMPT_VERSION } from '../agent/prompts/system.v3';
import { CONFIG } from '../config';
import { Area, Check, Field, Num, Select, Text, tidy } from './fields';
import { pretty, saveFile } from './api';
import { Icon } from '../ui/icons';
import { CodesPanel } from './CodesPanel';

type Cond = ExperimentDef['conditions'][string];
const newCond = (mode: Cond['agent']['mode'], seq: string[]): Cond => ({
  agent: { mode, ...(mode !== 'off' ? { model: 'gpt-5-mini' } : {}), promptVersion: PROMPT_VERSION, ...(mode !== 'off' ? { features: { visuals: false, plans: false, preview: false } } : {}) },
  taskSequence: seq,
});
export function newExperiment(id: string): ExperimentDef {
  const seq = Object.values(TASKS).filter((t) => t.demo).slice(0, 3).map((t) => t.id);
  return { id, version: '1', conditions: { suggest: newCond('suggest', seq), qa: newCond('qa', seq), off: newCond('off', seq) }, assignment: 'byCode', counterbalance: { method: 'latinSquare', over: 'taskSequence', fixedPrefix: 1 }, postSurveyUrl: '', logging: { telemetry: true, snapshotDebounceMs: 2000 } };
}

export function ExperimentEditor({ sourceId, onSaved }: { sourceId: string | null; onSaved(id: string): void }) {
  const isNew = !sourceId || !EXPERIMENTS[sourceId];
  const [d, setD] = useState<ExperimentDef>(() => (sourceId && EXPERIMENTS[sourceId] ? structuredClone(EXPERIMENTS[sourceId]) : newExperiment(uniq('my-study', Object.keys(EXPERIMENTS)))));
  const [initial] = useState(() => pretty(tidy(d)));
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const up = (fn: (e: ExperimentDef) => void) => setD((p) => { const n = structuredClone(p); fn(n); return n; });
  useEffect(() => setMsg(null), [d]);
  const taskOpts = Object.values(TASKS).map((t) => ({ value: t.id, label: `${t.title}${t.demo ? '' : ' (study only)'}` }));
  const models = [...new Set(['gpt-5-mini', ...CONFIG.demoModels])];

  const save = async () => {
    const clean = tidy(d);
    const r = ExperimentZ.safeParse(clean);
    const errs = r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    if (!Object.keys(d.conditions).length) errs.push('Add at least one condition.');
    for (const [n, c] of Object.entries(d.conditions)) {
      if (!c.taskSequence.length) errs.push(`Condition “${n}” has no tasks.`);
      for (const t of c.taskSequence) if (!TASKS[t]) errs.push(`Condition “${n}”: unknown task ${t}.`);
      if (c.agent.mode !== 'off' && !c.agent.model) errs.push(`Condition “${n}” needs a model.`);
    }
    const lens = new Set(Object.values(d.conditions).map((c) => c.taskSequence.length));
    if (lens.size > 1) errs.push('Every condition should have the same number of tasks so the conditions stay comparable.');
    if (errs.length) { setMsg({ tone: 'bad', text: errs.slice(0, 6).join(' · ') }); return; }
    try {
      await saveFile(`content/experiments/${clean.id}.json`, pretty(clean));
      setMsg({ tone: 'good', text: `Saved content/experiments/${clean.id}.json` });
      onSaved(clean.id);
    } catch (e) { setMsg({ tone: 'bad', text: (e as Error).message }); }
  };

  return (
    <div className="st-editor st-exp">
      <section className="st-center scroll">
        <div className="st-toolbar">
          <b>Experiment</b><span className="grow" />
          <button className="btn aqua" onClick={save}>Save experiment</button>
        </div>
        {msg && <div className={`st-msg ${msg.tone}`}>{msg.text}</div>}
        <div className="st-exp-grid">
          <div className="st-card">
            <Field label="File id" hint="content/experiments/<id>.json — participant codes point at this id">{isNew ? <Text mono value={d.id} onChange={(v) => up((e) => { e.id = v; })} /> : <code>{d.id}</code>}</Field>
            <Field label="Version" hint="bump it whenever you change a running study"><Text value={d.version} onChange={(v) => up((e) => { e.version = v; })} /></Field>
            <Field label="Post-study survey URL" hint="participants are sent here at the end with ?pid=<code>&exp=<id>"><Text value={d.postSurveyUrl} onChange={(v) => up((e) => { e.postSurveyUrl = v; })} placeholder="https://…" /></Field>
            <Check label="Counterbalance task order (Latin square)" value={!!d.counterbalance} onChange={(v) => up((e) => { e.counterbalance = v ? { method: 'latinSquare', over: 'taskSequence', fixedPrefix: 1 } : undefined; })} />
            {d.counterbalance && <Field label="Tasks kept first (not rotated)" hint="e.g. 1 keeps the tutorial first"><Num min={0} value={d.counterbalance.fixedPrefix} onChange={(v) => up((e) => { e.counterbalance!.fixedPrefix = v; })} /></Field>}
            <Check label="Log focus, idle and camera telemetry" value={d.logging.telemetry} onChange={(v) => up((e) => { e.logging.telemetry = v; })} />
          </div>

          {Object.entries(d.conditions).map(([name, c]) => (
            <div key={name} className="st-card cond">
              <div className="row"><b className="cond-name">{name}</b><span className="grow" />
                <button className="icon-btn" aria-label={`Remove condition ${name}`} onClick={() => up((e) => { delete e.conditions[name]; })}><Icon.trash width={12} height={12} /></button></div>
              <Field label="AI partner"><Select value={c.agent.mode} onChange={(v) => up((e) => { const a = e.conditions[name].agent; a.mode = v; if (v === 'off') { delete a.model; delete a.features; } else { a.model ??= 'gpt-5-mini'; a.features ??= { visuals: false, plans: false, preview: false }; } })}
                options={[{ value: 'suggest', label: 'Suggest: answers and proposes edits' }, { value: 'qa', label: 'Q&A: explains only' }, { value: 'off', label: 'Off: no AI partner' }]} /></Field>
              {c.agent.mode !== 'off' && (
                <>
                  <Field label="Model (locked for participants)"><Select value={c.agent.model} onChange={(v) => up((e) => { e.conditions[name].agent.model = v; })} options={models} /></Field>
                  <div className="feat">
                    <Check label="Visuals (block pictures, GIFs)" value={c.agent.features?.visuals} onChange={(v) => up((e) => { e.conditions[name].agent.features = { ...e.conditions[name].agent.features, visuals: v }; })} />
                    <Check label="Plans (self-ticking checklists)" value={c.agent.features?.plans} onChange={(v) => up((e) => { e.conditions[name].agent.features = { ...e.conditions[name].agent.features, plans: v }; })} />
                    {c.agent.mode === 'suggest' && <Check label="Ghost preview of suggestions" value={c.agent.features?.preview} onChange={(v) => up((e) => { e.conditions[name].agent.features = { ...e.conditions[name].agent.features, preview: v }; })} />}
                  </div>
                </>
              )}
              <Check label="Guided tour before the first task" value={c.tour !== false} onChange={(v) => up((e) => { e.conditions[name].tour = v ? undefined : false; })} />
              <Field label="Tasks, in order" wide>
                <ol className="seq">{c.taskSequence.map((t, i) => (
                  <li key={`${t}-${i}`}><span>{TASKS[t]?.title ?? t}{TASKS[t]?.timeLimitSec ? <small> · {Math.round(TASKS[t].timeLimitSec! / 60)} min</small> : null}</span>
                    <button className="icon-btn" aria-label="Move up" disabled={!i} onClick={() => up((e) => { const s = e.conditions[name].taskSequence; [s[i - 1], s[i]] = [s[i], s[i - 1]]; })}><Icon.up width={11} height={11} /></button>
                    <button className="icon-btn" aria-label="Remove task" onClick={() => up((e) => { e.conditions[name].taskSequence.splice(i, 1); })}><Icon.x width={11} height={11} /></button></li>
                ))}</ol>
                <Select value={undefined} allowEmpty="+ Add a task…" onChange={(t) => { if (t) up((e) => { e.conditions[name].taskSequence.push(t); }); }} options={taskOpts} />
                <button className="btn sm ghost" onClick={() => up((e) => { for (const k of Object.keys(e.conditions)) e.conditions[k].taskSequence = [...c.taskSequence]; })}>Use this order for every condition</button>
              </Field>
            </div>
          ))}
          <div className="st-card add">
            <AddCondition taken={Object.keys(d.conditions)} onAdd={(n, mode) => up((e) => { e.conditions[n] = newCond(mode, Object.values(e.conditions)[0]?.taskSequence ?? []); })} />
          </div>
        </div>
        <CodesPanel exp={d} saved={!isNew} dirty={!isNew && pretty(tidy(d)) !== initial} />
        <div className="st-card">
          <details className="st-json"><summary>JSON</summary><Area mono rows={14} value={pretty(tidy(d))} onChange={(v) => { try { setD(JSON.parse(v)); } catch { /* keep typing */ } }} /></details>
        </div>
      </section>
    </div>
  );
}

function AddCondition({ taken, onAdd }: { taken: string[]; onAdd(name: string, mode: Cond['agent']['mode']): void }) {
  const [n, setN] = useState('');
  const [mode, setMode] = useState<Cond['agent']['mode']>('suggest');
  const ok = /^[a-z][a-z0-9-]*$/.test(n) && !taken.includes(n);
  return (
    <>
      <b>Add a condition</b>
      <Field label="Name" hint="lowercase, e.g. suggest-visual"><Text mono value={n} onChange={setN} /></Field>
      <Field label="AI partner"><Select<Cond['agent']['mode']> value={mode} onChange={setMode} options={['suggest', 'qa', 'off']} /></Field>
      <button className="btn" disabled={!ok} onClick={() => { onAdd(n, mode); setN(''); }}><Icon.plus width={12} height={12} /> Add</button>
    </>
  );
}
const uniq = (base: string, taken: string[]) => { let i = 1, n = base; while (taken.includes(n)) n = `${base}-${++i}`; return n; };
