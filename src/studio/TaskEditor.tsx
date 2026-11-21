/** Studio: build a task on an environment — brief, goals, starter program, demo listing, and a tested reference solution. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ARMS, SCENES, TASKS, TaskZ, sceneForTask, type TaskDef } from '../content';
import type { PredicateDef, Target } from '../sim/types';
import { SimCore } from '../sim/SimCore';
import { runHeadless } from '../runtime/headless';
import { hashString, type RunTrace } from '../runtime/protocol';
import { evaluate } from '../sim/predicates/evaluators';
import { Preview, type PreviewHandle } from './Preview';
import { Area, Check, Field, Num, Select, Text, tidy } from './fields';
import { pretty, readFile, saveFile } from './api';
import { Icon } from '../ui/icons';

type P = Record<string, unknown> & { type: PredicateDef['type'] };
type Param = { k: string; label: string; kind: 'object' | 'region' | 'kind' | 'color' | 'num' | 'text' | 'target' | 'colormap'; optional?: boolean; step?: number };
const GOALS: Record<PredicateDef['type'], { title: string; params: Param[] }> = {
  objectInRegion: { title: 'A part ends up in a zone', params: [{ k: 'object', label: 'Part', kind: 'object' }, { k: 'region', label: 'Zone', kind: 'region' }, { k: 'tolMm', label: 'Tolerance (mm)', kind: 'num', optional: true }] },
  countInRegion: { title: 'A number of parts in a zone', params: [{ k: 'count', label: 'How many', kind: 'num' }, { k: 'kind', label: 'Kind', kind: 'kind' }, { k: 'region', label: 'Zone', kind: 'region' }, { k: 'color', label: 'Only this color', kind: 'color', optional: true }] },
  sortedByColor: { title: 'Parts sorted into zones by color', params: [{ k: 'kind', label: 'Kind', kind: 'kind' }, { k: 'map', label: 'Color → zone', kind: 'colormap' }, { k: 'minCount', label: 'At least (parts)', kind: 'num', optional: true }] },
  stackPattern: { title: 'A rows × cols × layers stack', params: [{ k: 'region', label: 'Zone', kind: 'region' }, { k: 'kind', label: 'Kind', kind: 'kind' }, { k: 'rows', label: 'Rows', kind: 'num' }, { k: 'cols', label: 'Columns', kind: 'num' }, { k: 'layers', label: 'Layers', kind: 'num' }, { k: 'tolMm', label: 'Tolerance (mm)', kind: 'num', optional: true }] },
  upright: { title: 'A part stays upright', params: [{ k: 'object', label: 'Part', kind: 'object' }] },
  fillAtLeast: { title: 'A cup is filled', params: [{ k: 'object', label: 'Cup', kind: 'object' }, { k: 'frac', label: 'At least (0–1)', kind: 'num', step: 0.05 }] },
  spilledAtMost: { title: 'Little liquid spilled', params: [{ k: 'frac', label: 'At most (0–1)', kind: 'num', step: 0.05 }] },
  noFaults: { title: 'No protective stops in the run', params: [] },
  simTimeBelow: { title: 'Finishes within a cycle time', params: [{ k: 'sec', label: 'Seconds', kind: 'num' }] },
  programCompleted: { title: 'The program runs to the end', params: [] },
  targetTaught: { title: 'A position is taught by hand', params: [{ k: 'name', label: 'Position name', kind: 'text' }] },
  holding: { title: 'The gripper holds a part', params: [{ k: 'object', label: 'Part (any if empty)', kind: 'object', optional: true }] },
};
const COLORS = ['red', 'green', 'blue', 'yellow', 'orange', 'purple', 'white', 'black'];

export function newTask(id: string): TaskDef {
  const sceneId = Object.keys(SCENES)[0];
  return { id, title: 'My task', brief: 'Describe what the robot should do.\n\n- Use bullet points for steps\n- Mention the named positions the user can use', sceneId, armId: 'gofa-like', seed: 1, editor: 'blocks', passOn: 'run', predicates: [], hints: [] } as TaskDef;
}

export function TaskEditor({ sourceId, onSaved }: { sourceId: string | null; onSaved(id: string): void }) {
  const isNew = !sourceId || !TASKS[sourceId];
  const [d, setD] = useState<TaskDef>(() => (sourceId && TASKS[sourceId] ? structuredClone(TASKS[sourceId]) : newTask(uniq('my-task', Object.keys(TASKS)))));
  const [solution, setSolution] = useState('');
  const [noSolution, setNoSolution] = useState(false);
  const [test, setTest] = useState<{ hash: string; trace: RunTrace } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const pv = useRef<PreviewHandle>(null);
  const up = (fn: (t: TaskDef) => void) => setD((p) => { const n = structuredClone(p); fn(n); return n; });

  useEffect(() => {
    if (!sourceId) { setSolution('await robot.home();\nawait gripper.open();\n// move to the part, grip, move to the goal, release\n'); return; }
    readFile(`tests/fixtures/solutions/${sourceId}.js`).then((r) => { setSolution(r.content ?? ''); setNoSolution(!r.exists && TASKS[sourceId]?.passOn === 'live'); }).catch(() => undefined);
  }, [sourceId]);

  const scene = useMemo(() => { try { return SCENES[d.sceneId] ? sceneForTask(d) : null; } catch { return null; } }, [d]);
  const arm = ARMS[d.armId] ?? null;
  const targets = useMemo(() => Object.fromEntries(Object.entries(d.presetTargets ?? {}).map(([n, pose]) => [n, { name: n, pose, source: 'preset' as const }])) as Record<string, Target>, [d.presetTargets]);
  const hash = hashString(JSON.stringify([tidy(d), solution]));
  const passed = !!test && test.hash === hash && test.trace.outcome === 'completed' && test.trace.predicates.every((p) => p.pass) && d.predicates.length > 0;

  const objects = scene?.objects.map((o) => o.id) ?? [];
  const regions = scene?.regions.map((r) => r.id) ?? [];
  const kinds = [...new Set([...(scene?.objects.map((o) => o.kind) ?? []), ...(scene?.conveyors.map((c) => c.spawn.kind) ?? [])])];
  const posNames = scene ? [...Object.keys(scene.sceneTargets), ...Object.keys(d.presetTargets ?? {})] : [];

  const runTest = async () => {
    if (!scene || !arm) return;
    setBusy(true);
    const sim = new SimCore(structuredClone(scene), arm, { seed: d.seed });
    sim.setTargets(targets);
    const trace = await runHeadless(sim, solution, { predicates: d.predicates, seed: d.seed, maxSimTimeSec: d.maxSimTimeSec ?? 600 });
    setTest({ hash, trace });
    setBusy(false);
  };
  const save = async () => {
    const clean = tidy({ ...d, hints: d.hints?.filter(Boolean) });
    const r = TaskZ.safeParse(clean);
    const errs = r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    if (!d.predicates.length) errs.push('Add at least one goal.');
    if (!noSolution && !passed) errs.push('Test the reference solution — it must complete and pass every goal before saving.');
    if (noSolution && d.passOn !== 'live') errs.push('Only “passed live” tasks (e.g. teach a position) may skip the reference solution.');
    if (errs.length) { setMsg({ tone: 'bad', text: errs.slice(0, 6).join(' · ') }); return; }
    try {
      await saveFile(`content/tasks/${clean.id}.json`, pretty(clean));
      if (!noSolution) await saveFile(`tests/fixtures/solutions/${clean.id}.js`, solution);
      setMsg({ tone: 'good', text: `Saved content/tasks/${clean.id}.json${noSolution ? '' : ` and tests/fixtures/solutions/${clean.id}.js`}` });
      onSaved(clean.id);
    } catch (e) { setMsg({ tone: 'bad', text: (e as Error).message }); }
  };
  useEffect(() => setMsg(null), [d, solution, test]);

  const goalField = (g: P, i: number, p: Param) => {
    const v = g[p.k];
    const set = (x: unknown) => up((t) => { const q = t.predicates[i] as unknown as P; if (x === undefined || x === '') delete q[p.k]; else q[p.k] = x; });
    const opts = p.kind === 'object' ? objects : p.kind === 'region' ? regions : p.kind === 'kind' ? kinds : p.kind === 'color' ? COLORS : posNames;
    if (p.kind === 'num') return <Num step={p.step} value={v as number | undefined} onChange={set} />;
    if (p.kind === 'text') return <Text value={v as string} onChange={set} placeholder="P1" />;
    if (p.kind === 'colormap') {
      const map = (v as Record<string, string>) ?? {};
      return <span className="stack-s">{COLORS.map((c) => <span key={c} className="row"><span className={`swatch c-${c}`} />{c}<Select value={map[c]} allowEmpty="—" onChange={(z) => { const m = { ...map }; if (z) m[c] = z; else delete m[c]; set(m); }} options={regions} /></span>)}</span>;
    }
    return <Select value={v as string} allowEmpty={p.optional ? 'any' : 'choose…'} onChange={set} options={opts} />;
  };

  return (
    <div className="st-editor">
      <aside className="st-inspector left">
        <h3>Task</h3>
        <Field label="File id" hint={isNew ? 'content/tasks/<id>.json' : undefined}>{isNew ? <Text mono value={d.id} onChange={(v) => up((t) => { t.id = v; })} /> : <code>{d.id}</code>}</Field>
        <Field label="Title"><Text value={d.title} onChange={(v) => up((t) => { t.title = v; })} /></Field>
        <Field label="Brief" hint="Markdown: **bold**, `code`, - lists" wide><Area rows={6} value={d.brief} onChange={(v) => up((t) => { t.brief = v; })} /></Field>
        <Field label="Environment"><Select value={d.sceneId} onChange={(v) => up((t) => { t.sceneId = v; t.predicates = []; })} options={Object.values(SCENES).map((s) => ({ value: s.id, label: s.title }))} /></Field>
        <Field label="Robot"><Select value={d.armId} onChange={(v) => up((t) => { t.armId = v; })} options={Object.values(ARMS).map((a) => ({ value: a.id, label: a.name }))} /></Field>
        <Field label="Programming with"><Select value={d.editor} onChange={(v) => up((t) => { t.editor = v; })} options={[{ value: 'blocks', label: 'Blocks' }, { value: 'code', label: 'JavaScript' }]} /></Field>
        <Field label="Task passes when"><Select value={d.passOn} onChange={(v) => up((t) => { t.passOn = v; })} options={[{ value: 'run', label: 'a program run meets every goal' }, { value: 'live', label: 'the goals are met at any moment (e.g. by jogging)' }]} /></Field>
        {d.editor === 'code'
          ? <Field label="Starter code" wide><Area mono rows={6} value={d.starter?.code} onChange={(v) => up((t) => { t.starter = v ? { code: v } : undefined; })} /></Field>
          : <Check label="Start with a “Go home” block" value={!!d.starter?.blocks?.length} onChange={(v) => up((t) => { t.starter = v ? { blocks: [{ type: 'robot_home' }] } : undefined; })} />}
        <Field label="Hints (one per line, revealed one at a time)" wide><Area rows={3} value={(d.hints ?? []).join('\n')} onChange={(v) => up((t) => { t.hints = v.split('\n'); })} /></Field>
        <Field label="Time limit in a study (s)" hint="empty = no limit"><Num value={d.timeLimitSec} onChange={(v) => up((t) => { t.timeLimitSec = v; })} /></Field>
        <Field label="Random seed" hint="changes conveyor color order"><Num value={d.seed} onChange={(v) => up((t) => { t.seed = v ?? 1; })} /></Field>
        {scene?.conveyors.map((c) => {
          const o = (d.conveyorOverrides?.[c.id] ?? {}) as { count?: number; colors?: string[] };
          const set = (p: object) => up((t) => { t.conveyorOverrides = { ...t.conveyorOverrides, [c.id]: tidy({ ...o, ...p }) }; });
          return <Field key={c.id} label={`Conveyor ${c.id}: parts · colors`} hint={`environment default: ${SCENES[d.sceneId].conveyors.find((x) => x.id === c.id)?.spawn.count} × ${SCENES[d.sceneId].conveyors.find((x) => x.id === c.id)?.spawn.colors.join(', ')}`}>
            <span className="row"><Num value={o.count} placeholder="default" onChange={(v) => set({ count: v })} /><Text value={o.colors?.join(', ')} placeholder="default" onChange={(v) => set({ colors: v ? v.split(',').map((x) => x.trim()).filter(Boolean) : undefined })} /></span>
          </Field>;
        })}
        <h3>Demo</h3>
        <Check label="Show in the demo level list" value={!!d.demo} onChange={(v) => up((t) => { t.demo = v ? { order: Math.max(0, ...Object.values(TASKS).map((x) => x.demo?.order ?? 0)) + 10 } : undefined; })} />
        {d.demo && <Field label="Position" hint={`levels are sorted by this; current: ${Object.values(TASKS).filter((x) => x.demo && x.id !== d.id).sort((a, b) => a.demo!.order - b.demo!.order).map((x) => `${x.demo!.order} ${x.title}`).join(' · ')}`}><Num value={d.demo.order} onChange={(v) => up((t) => { t.demo = { order: v ?? 0 }; })} /></Field>}
        <Field label="Difficulty"><Select value={String(d.difficulty ?? '')} allowEmpty="—" onChange={(v) => up((t) => { t.difficulty = v ? (Number(v) as 1 | 2 | 3) : undefined; })} options={[{ value: '1', label: 'Easy' }, { value: '2', label: 'Medium' }, { value: '3', label: 'Hard' }]} /></Field>
        <p className="st-help">Study-only tasks: leave “Show in the demo” off and add them to an experiment.</p>
      </aside>

      <section className="st-center">
        <div className="st-toolbar">
          <span className="muted small">Preview of {SCENES[d.sceneId]?.title ?? '—'} with {arm?.name ?? '—'}</span>
          <span className="grow" />
          <span className={`chip ${noSolution ? '' : passed ? 'leaf' : 'amber'}`}>{noSolution ? 'No solution (passed live)' : passed ? 'Solution passes' : 'Solution not tested'}</span>
          <button className="btn aqua" onClick={save}>Save task</button>
        </div>
        <Preview ref={pv} scene={scene} arm={arm} seed={d.seed} targets={targets} />
        {msg && <div className={`st-msg ${msg.tone}`}>{msg.text}</div>}
      </section>

      <aside className="st-inspector">
        <h3>Goals</h3>
        {d.predicates.map((g0, i) => {
          const g = g0 as unknown as P;
          return (
            <fieldset key={i} className="st-goal">
              <legend>{i + 1}. {GOALS[g.type]?.title}</legend>
              {GOALS[g.type]?.params.map((p) => <Field key={p.k} label={p.label}>{goalField(g, i, p)}</Field>)}
              <Field label="Shown as" hint="leave empty for the automatic wording"><Text value={g.label as string} onChange={(v) => up((t) => { const q = t.predicates[i] as unknown as P; if (v) q.label = v; else delete q.label; })} /></Field>
              <div className="row"><span className="grow" />
                <button className="icon-btn" aria-label="Move goal up" disabled={!i} onClick={() => up((t) => { [t.predicates[i - 1], t.predicates[i]] = [t.predicates[i], t.predicates[i - 1]]; })}><Icon.up width={12} height={12} /></button>
                <button className="icon-btn" aria-label="Remove goal" onClick={() => up((t) => { t.predicates.splice(i, 1); })}><Icon.trash width={12} height={12} /></button>
              </div>
            </fieldset>
          );
        })}
        <Select value={undefined} allowEmpty="+ Add a goal…" onChange={(type) => { if (type) up((t) => { t.predicates.push(defaultGoal(type as PredicateDef['type'], objects, regions, kinds)); }); }}
          options={Object.entries(GOALS).map(([k, v]) => ({ value: k as PredicateDef['type'], label: v.title }))} />
        {scene && d.predicates.length > 0 && <LiveGoals scene={scene} task={d} />}

        <h3>Reference solution</h3>
        <p className="st-help">JavaScript that solves the task. It proves the task is possible and keeps working as Tandem changes (it runs in the unit tests). Named positions: {posNames.join(', ') || 'none yet'}.</p>
        {d.passOn === 'live' && <Check label="No solution — this task is passed by hand (e.g. teaching a position)" value={noSolution} onChange={setNoSolution} />}
        {!noSolution && (
          <>
            <Area mono rows={12} value={solution} onChange={setSolution} />
            <details className="st-api"><summary>Robot API</summary>
              <pre>{`await robot.moveJ('pick.approach')      // joint move
await robot.moveL('pick', { speed: 30 })  // straight line, %
await robot.home()
await gripper.open() / gripper.close()
await io.waitFor('part_present', true)
await io.set('conveyor_run', false)
await robot.wait(500)
offset('place', dx, dy, dz)               // shifted pose (mm)
for (let i = 0; i < 3; i++) { … }`}</pre>
            </details>
            <div className="row">
              <button className="btn" disabled={busy} onClick={runTest}><Icon.check width={12} height={12} /> {busy ? 'Testing…' : 'Test'}</button>
              <button className="btn" onClick={() => void pv.current?.play(solution, d.predicates, d.seed).then((t) => t && setTest({ hash, trace: t }))}><Icon.play width={11} height={11} /> Watch</button>
              <button className="btn ghost" onClick={() => pv.current?.stop()}><Icon.stop width={11} height={11} /> Stop</button>
            </div>
            {test && test.hash === hash && (
              <div className={`st-result ${passed ? 'good' : 'bad'}`}>
                <b>{test.trace.outcome === 'completed' ? `Completed in ${test.trace.simDurationSec}s (simulated)` : `${test.trace.fault?.code}: ${test.trace.fault?.message}${test.trace.fault?.line ? ` (line ${test.trace.fault.line})` : ''}`}</b>
                <ul>{test.trace.predicates.map((p, k) => <li key={k} className={p.pass ? 'pass' : 'fail'}>{p.pass ? <Icon.check width={11} height={11} /> : <Icon.x width={11} height={11} />} {p.label}{p.detail ? ` — ${p.detail}` : ''}</li>)}</ul>
              </div>
            )}
          </>
        )}
        <details className="st-json"><summary>JSON</summary><Area mono rows={14} value={pretty(tidy(d))} onChange={(v) => { try { setD(JSON.parse(v)); } catch { /* keep typing */ } }} /></details>
      </aside>
    </div>
  );
}

/** Goals evaluated on the untouched scene — most should start unmet. */
function LiveGoals({ scene, task }: { scene: NonNullable<ReturnType<typeof sceneForTask>>; task: TaskDef }) {
  const res = useMemo(() => {
    try {
      const arm = ARMS[task.armId]; if (!arm) return [];
      const sim = new SimCore(structuredClone(scene), arm, { seed: task.seed });
      return task.predicates.map((p) => evaluate(p, sim.s, { scene, targets: sim.allTargets(), programCompleted: false, runStartTime: 0, runFaults: 0, totalLiquid: sim.s.totalLiquid }));
    } catch (e) { return [{ label: `Goal error: ${(e as Error).message}`, pass: false }]; }
  }, [scene, task]);
  return <div className="st-help">At the start: {res.map((r, i) => <span key={i} className={`chip ${r.pass ? 'amber' : ''}`} title={r.pass ? 'Already met before the robot moves — is that intended?' : 'Not met yet (good)'}>{r.label}</span>)}</div>;
}

function defaultGoal(type: PredicateDef['type'], objects: string[], regions: string[], kinds: string[]): PredicateDef {
  const o = objects[0] ?? '', r = regions[0] ?? '', k = kinds[0] ?? 'part';
  const m: Record<PredicateDef['type'], PredicateDef> = {
    objectInRegion: { type: 'objectInRegion', object: o, region: r }, countInRegion: { type: 'countInRegion', kind: k, region: r, count: 1 },
    sortedByColor: { type: 'sortedByColor', kind: k, map: {} }, stackPattern: { type: 'stackPattern', region: r, kind: k, rows: 2, cols: 2, layers: 1 },
    upright: { type: 'upright', object: o }, fillAtLeast: { type: 'fillAtLeast', object: o, frac: 0.6 }, spilledAtMost: { type: 'spilledAtMost', frac: 0.1 },
    noFaults: { type: 'noFaults' }, simTimeBelow: { type: 'simTimeBelow', sec: 60 }, programCompleted: { type: 'programCompleted' },
    targetTaught: { type: 'targetTaught', name: 'P1' }, holding: { type: 'holding' },
  };
  return m[type];
}
const uniq = (base: string, taken: string[]) => { let i = 1, n = base; while (taken.includes(n)) n = `${base}-${++i}`; return n; };
