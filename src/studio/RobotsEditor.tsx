/** Studio: your 3D model files, URDF import, and robot arms built from your own meshes. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ARMS } from '../content';
import { buildArm } from '../sim/kinematics/arm';
import type { ArmDef, ArmJson, ArmMeshPart, SceneDef } from '../sim/types';
import { parseUrdf, urdfTips, urdfToArm, type UrdfModel } from '../content/urdf';
import { modelUrl, modelSizeMm, modelNodeNames, defaultUnits, defaultUp } from '../view/meshes';
import { Preview, type PreviewHandle } from './Preview';
import { Area, Field, Num, Select, Text, Vec3, tidy } from './fields';
import { pretty, saveFile } from './api';
import { newScene } from './SceneEditor';
import { Icon } from '../ui/icons';

const armFiles = import.meta.glob('../../content/arms/*.json', { eager: true, import: 'default' }) as Record<string, ArmJson>;
const ARM_JSON: Record<string, ArmJson> = Object.fromEntries(Object.values(armFiles).map((j) => [j.id, j]));
const STAGE: SceneDef = { ...newScene('studio-stage'), camera: { position: [1700, -1500, 1200], target: [0, 0, 350] } };

export function RobotsEditor({ models, onSaved }: { models: string[]; onSaved(id: string): void }) {
  const [mode, setMode] = useState<{ kind: 'file'; file: string } | { kind: 'arm'; json: ArmJson; isNew: boolean } | null>(null);
  const urdfs = models.filter((m) => m.endsWith('.urdf'));
  const meshes = models.filter((m) => !m.endsWith('.urdf'));
  return (
    <div className="st-editor">
      <aside className="st-outline">
        <div className="st-group"><div className="st-group-h">Robot arms</div>
          {Object.values(ARM_JSON).map((a) => <button key={a.id} className={`st-item ${mode?.kind === 'arm' && mode.json.id === a.id ? 'on' : ''}`} onClick={() => setMode({ kind: 'arm', json: structuredClone(a), isNew: false })}>{a.name}</button>)}
          <button className="st-item add" onClick={() => setMode({ kind: 'arm', json: blankArm(), isNew: true })}><Icon.plus width={12} height={12} /> New arm from meshes</button>
        </div>
        <div className="st-group"><div className="st-group-h">URDF robots</div>
          {urdfs.map((f) => <button key={f} className={`st-item ${mode?.kind === 'file' && mode.file === f ? 'on' : ''}`} onClick={() => setMode({ kind: 'file', file: f })}>{f.replace(/^models\//, '')}</button>)}
          {!urdfs.length && <p className="st-help">Copy a robot's URDF folder (urdf + meshes) into <code>public/models/</code>.</p>}
        </div>
        <div className="st-group"><div className="st-group-h">Model files</div>
          {meshes.map((f) => <button key={f} className={`st-item ${mode?.kind === 'file' && mode.file === f ? 'on' : ''}`} onClick={() => setMode({ kind: 'file', file: f })}>{f.replace(/^models\//, '')}</button>)}
        </div>
      </aside>
      {!mode && <section className="st-center st-empty"><h2>Robots & models</h2><p>Pick a model file to preview it, a URDF to import a robot, or an arm to edit how it looks.</p>
        <p className="st-help">Formats: <b>.glb / .gltf</b> (best — keeps materials), <b>.obj</b>, <b>.stl</b>, <b>.dae</b>. Put files anywhere under <code>public/models/</code>. Models are visual only: collisions and grasping use simple boxes, cylinders and capsules, so tasks behave the same for everyone.</p></section>}
      {mode?.kind === 'file' && (mode.file.endsWith('.urdf')
        ? <UrdfImport key={mode.file} file={mode.file} models={models} onImported={(json) => setMode({ kind: 'arm', json, isNew: true })} />
        : <ModelViewer key={mode.file} file={mode.file} />)}
      {mode?.kind === 'arm' && <ArmEditor key={`${mode.json.id}-${mode.isNew}`} initial={mode.json} isNew={mode.isNew} meshes={meshes} onSaved={onSaved} />}
    </div>
  );
}

function blankArm(): ArmJson {
  const base = structuredClone(ARM_JSON['gofa-like'] ?? Object.values(ARM_JSON)[0]);
  return { ...base, id: 'my-arm', name: 'My arm', visual: { source: 'mesh', parts: [] } };
}

/** Preview one model file and report its size. */
function ModelViewer({ file }: { file: string }) {
  const [units, setUnits] = useState(defaultUnits(file));
  const [upAxis, setUp] = useState(defaultUp(file));
  const [size, setSize] = useState<[number, number, number] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { setSize(null); setErr(''); modelSizeMm({ file, units, upAxis }).then(setSize).catch((e) => setErr(e?.message ?? 'Could not load')); }, [file, units, upAxis]);
  const scene: SceneDef = useMemo(() => ({ ...STAGE, fixtures: [...STAGE.fixtures, { id: 'model', kind: 'model', center: [350, 0, (size?.[2] ?? 200) / 2], size: size ?? [200, 200, 200], mesh: { file, units, upAxis } }] }), [file, units, upAxis, size]);
  return (
    <>
      <section className="st-center">
        <div className="st-toolbar"><b>{file}</b><span className="grow" />{size && <span className="chip">{size[0]} × {size[1]} × {size[2]} mm</span>}</div>
        <Preview scene={scene} arm={ARMS['gofa-like']} />
        {err && <div className="st-msg bad">{err}</div>}
      </section>
      <aside className="st-inspector">
        <h3>How the file was made</h3>
        <Field label="Units"><Select value={units} onChange={(v) => setUnits(v as typeof units)} options={['m', 'cm', 'mm', 'in']} /></Field>
        <Field label="Up axis"><Select value={upAxis} onChange={(v) => setUp(v as typeof upAxis)} options={[{ value: 'y', label: 'Y up' }, { value: 'z', label: 'Z up' }]} /></Field>
        <p className="st-help">Compare it to the robot for scale. If it looks huge or tiny, change the units; if it lies on its side, change the up axis. Then use it in the Environments tab (as a 3D-model fixture or as a part's look) — it's referenced as <code>{file}</code>.</p>
        <a className="btn sm" href={modelUrl(file)} download>Download file</a>
      </aside>
    </>
  );
}

/** Read a URDF, pick the end link, convert to an arm. */
function UrdfImport({ file, models, onImported }: { file: string; models: string[]; onImported(json: ArmJson): void }) {
  const [m, setM] = useState<UrdfModel | null>(null);
  const [err, setErr] = useState('');
  const [tip, setTip] = useState('');
  const [id, setId] = useState(file.split('/').pop()!.replace(/\.urdf$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  const [toolZ, setToolZ] = useState(120);
  const [radius, setRadius] = useState(45);
  useEffect(() => {
    fetch(modelUrl(file)).then((r) => r.text()).then((t) => { const p = parseUrdf(t); setM(p); setTip(urdfTips(p)[0] ?? ''); }).catch((e) => setErr(e.message));
  }, [file]);
  const res = useMemo(() => { if (!m || !tip) return null; try { return urdfToArm(m, { id, tip, urdfPath: file, toolZmm: toolZ, linkRadiusMm: radius }); } catch (e) { return { error: (e as Error).message }; } }, [m, tip, id, toolZ, radius, file]);
  const missing = res && 'meshFiles' in res ? res.meshFiles.filter((f) => !models.includes(f)) : [];
  return (
    <section className="st-center scroll">
      <div className="st-toolbar"><b>Import URDF</b><span className="muted small">{file}</span><span className="grow" />
        <button className="btn aqua" disabled={!res || 'error' in res} onClick={() => res && 'arm' in res && onImported(res.arm)}>Continue to the arm editor</button></div>
      {err && <div className="st-msg bad">{err}</div>}
      {m && (
        <div className="st-card">
          <Field label="Robot">{m.name} · {m.joints.filter((j) => j.type !== 'fixed').length} moving joints · root link <code>{m.root}</code></Field>
          <Field label="End of the arm (flange link)" hint="the gripper is attached here"><Select value={tip} onChange={setTip} options={urdfTips(m).concat(m.links.filter((l) => !urdfTips(m).includes(l) && l !== m.root))} /></Field>
          <Field label="Arm id" hint="content/arms/<id>.json"><Text mono value={id} onChange={setId} /></Field>
          <Field label="Gripper length from the flange (mm)"><Num value={toolZ} onChange={(v) => setToolZ(v ?? 0)} /></Field>
          <Field label="Collision radius of the links (mm)" hint="capsules around each link; adjust per link later"><Num value={radius} onChange={(v) => setRadius(v ?? 40)} /></Field>
          {res && 'error' in res && <div className="chip rose">{res.error}</div>}
          {res && 'arm' in res && (
            <>
              <p className="st-help">{res.arm.jointLimitsDeg.length} joints · {res.meshFiles.length} mesh files</p>
              {missing.length > 0 && <div className="st-msg bad">Missing mesh files (copy them into public/models): {missing.join(', ')}</div>}
              {res.warnings.map((w) => <div key={w} className="chip amber">{w}</div>)}
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** Edit an arm's look (per-link meshes and/or one file with named nodes), check it with joint sliders, save. */
function ArmEditor({ initial, isNew, meshes, onSaved }: { initial: ArmJson; isNew: boolean; meshes: string[]; onSaved(id: string): void }) {
  const [j, setJ] = useState<ArmJson>(initial);
  const [q, setQ] = useState<number[]>(initial.homeDeg.slice());
  const [nodes, setNodes] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const pv = useRef<PreviewHandle>(null);
  const up = (fn: (a: ArmJson) => void) => setJ((p) => { const n = structuredClone(p); fn(n); return n; });
  const built: ArmDef | null = useMemo(() => { try { return buildArm(structuredClone(j)); } catch { return null; } }, [j]);
  const linkNames = built?.links.map((l, i) => ({ value: l.name, label: `${i}: ${l.name}${l.joint ? ` (J${l.joint.index + 1})` : ''}` })) ?? [];
  const types = built?.links.filter((l) => l.joint).map((l) => l.joint!.type) ?? [];
  useEffect(() => { if (built) pv.current?.setJoints(q.map((v, i) => (types[i] === 'P' ? v / 1000 : (v * Math.PI) / 180))); });
  useEffect(() => setMsg(null), [j]);
  const vis = j.visual;
  const meshVis = vis.source === 'mesh' ? vis : null;
  useEffect(() => { if (meshVis?.model?.file) modelNodeNames(meshVis.model.file).then(setNodes).catch(() => setNodes([])); else setNodes([]); }, [meshVis?.model?.file]);

  const setParts = (fn: (p: ArmMeshPart[]) => void) => up((a) => { if (a.visual.source !== 'mesh') a.visual = { source: 'mesh', parts: [] }; const v = a.visual as Extract<ArmJson['visual'], { source: 'mesh' }>; v.parts ??= []; fn(v.parts); });
  const save = async () => {
    const errs: string[] = [];
    if (!/^[a-z0-9][a-z0-9-]*$/.test(j.id)) errs.push('Arm id: lowercase letters, digits and dashes.');
    if (isNew && ARM_JSON[j.id]) errs.push(`An arm called ${j.id} already exists.`);
    if (!built) errs.push('The kinematics could not be built (check links/DH rows).');
    else {
      if (j.jointLimitsDeg.length !== built.dof) errs.push(`Joint limits: ${j.jointLimitsDeg.length} given, the arm has ${built.dof} joints.`);
      if (j.homeDeg.length !== built.dof) errs.push(`Home pose: ${j.homeDeg.length} values, the arm has ${built.dof} joints.`);
    }
    if (errs.length) { setMsg({ tone: 'bad', text: errs.join(' · ') }); return; }
    try {
      await saveFile(`content/arms/${j.id}.json`, pretty(tidy(j)));
      setMsg({ tone: 'good', text: `Saved content/arms/${j.id}.json — choose it in a task, or in the demo's Settings.` });
      onSaved(j.id);
    } catch (e) { setMsg({ tone: 'bad', text: (e as Error).message }); }
  };

  return (
    <>
      <section className="st-center">
        <div className="st-toolbar"><b>{j.name}</b><span className="grow" /><button className="btn aqua" onClick={save}>Save arm</button></div>
        <Preview ref={pv} scene={STAGE} arm={built} />
        {msg && <div className={`st-msg ${msg.tone}`}>{msg.text}</div>}
      </section>
      <aside className="st-inspector">
        <h3>Arm</h3>
        <Field label="Id">{isNew ? <Text mono value={j.id} onChange={(v) => up((a) => { a.id = v; })} /> : <code>{j.id}</code>}</Field>
        <Field label="Name"><Text value={j.name} onChange={(v) => up((a) => { a.name = v; })} /></Field>
        <Field label="Joints" hint="drag to check the meshes follow; the home pose is where every task starts" wide>
          {q.map((v, i) => {
            const l = j.jointLimitsDeg[i] ?? { min: -180, max: 180 };
            return <div key={i} className="joint-row"><span>J{i + 1}</span><input type="range" min={l.min} max={l.max} step={0.5} value={v} onChange={(e) => { const n = q.slice(); n[i] = +e.target.value; setQ(n); }} /><span className="mono">{v.toFixed(0)}{types[i] === 'P' ? 'mm' : '°'}</span></div>;
          })}
          <div className="row"><button className="btn sm" onClick={() => up((a) => { a.homeDeg = q.map((x) => Math.round(x * 10) / 10); })}>Set home to this pose</button><button className="btn sm ghost" onClick={() => setQ(j.homeDeg.slice())}>Back to home</button></div>
        </Field>
        <Field label="Gripper offset from the flange (mm)"><Num value={j.tool.z} onChange={(v) => up((a) => { a.tool.z = v ?? 0; })} /></Field>

        <h3>Look</h3>
        <Field label="Drawn as"><Select value={vis.source === 'mesh' ? 'mesh' : vis.source} onChange={(s) => up((a) => { a.visual = s === 'mesh' ? { source: 'mesh', parts: [] } : s === 'procedural' ? { source: 'procedural', color: '#f4f6f8', accent: '#2d9bf0' } : initial.visual; })}
          options={[{ value: 'mesh', label: 'My models' }, { value: 'procedural', label: 'Generated shapes' }, ...(initial.visual.source === 'uaibot' ? [{ value: 'uaibot' as const, label: 'Built-in model' }] : [])]} /></Field>
        {meshVis && (
          <>
            <fieldset className="st-mesh"><legend>One file per link</legend>
              {(meshVis.parts ?? []).map((p, i) => (
                <div key={i} className="part">
                  <div className="row"><Select value={String(p.link)} onChange={(v) => setParts((ps) => { ps[i].link = v; })} options={linkNames} />
                    <button className="icon-btn" aria-label="Remove part" onClick={() => setParts((ps) => { ps.splice(i, 1); })}><Icon.x width={12} height={12} /></button></div>
                  <Select value={p.file} onChange={(v) => setParts((ps) => { ps[i].file = v; })} options={meshes} />
                  <div className="row"><Select value={p.units ?? defaultUnits(p.file)} onChange={(v) => setParts((ps) => { ps[i].units = v; })} options={['m', 'cm', 'mm', 'in']} />
                    <Select value={p.upAxis ?? defaultUp(p.file)} onChange={(v) => setParts((ps) => { ps[i].upAxis = v; })} options={[{ value: 'y', label: 'Y up' }, { value: 'z', label: 'Z up' }]} />
                    <Select value={p.frame ?? 'link'} onChange={(v) => setParts((ps) => { ps[i].frame = v === 'link' ? undefined : v; })} options={[{ value: 'link', label: 'in link frame' }, { value: 'zero', label: 'modelled in place' }]} /></div>
                  <Field label="Offset (mm) · rotation (deg)"><Vec3 value={p.offset} onChange={(v) => setParts((ps) => { ps[i].offset = v; })} /><Vec3 labels={['rx', 'ry', 'rz']} value={p.rotation} onChange={(v) => setParts((ps) => { ps[i].rotation = v; })} /></Field>
                </div>
              ))}
              <button className="btn sm" disabled={!meshes.length} onClick={() => setParts((ps) => { ps.push({ link: built?.links[Math.min(ps.length, (built?.links.length ?? 1) - 1)].name ?? 0, file: meshes[0] }); })}><Icon.plus width={12} height={12} /> Add a part</button>
            </fieldset>
            <fieldset className="st-mesh"><legend>Or one file with named parts</legend>
              <Select value={meshVis.model?.file} allowEmpty="none" onChange={(f) => up((a) => { const v = a.visual as Extract<ArmJson['visual'], { source: 'mesh' }>; if (f) v.model = { file: f, nodes: v.model?.nodes ?? {} }; else delete v.model; })} options={meshes.filter((f) => /\.(glb|gltf|dae)$/i.test(f))} />
              {meshVis.model && (
                <>
                  <p className="st-help">Model the whole arm in place with every joint at 0, name each moving part, then assign parts to links here. Unassigned parts ride on the base.</p>
                  {nodes.map((n) => (
                    <div key={n} className="row node-row"><span className="mono">{n}</span>
                      <Select value={meshVis.model!.nodes[n] !== undefined ? String(meshVis.model!.nodes[n]) : ''} allowEmpty="—" onChange={(v) => up((a) => { const mv = (a.visual as Extract<ArmJson['visual'], { source: 'mesh' }>).model!; if (v) mv.nodes[n] = v; else delete mv.nodes[n]; })} options={linkNames} /></div>
                  ))}
                  <div className="row"><Select value={meshVis.model.units ?? defaultUnits(meshVis.model.file)} onChange={(v) => up((a) => { (a.visual as Extract<ArmJson['visual'], { source: 'mesh' }>).model!.units = v; })} options={['m', 'cm', 'mm', 'in']} />
                    <Select value={meshVis.model.upAxis ?? defaultUp(meshVis.model.file)} onChange={(v) => up((a) => { (a.visual as Extract<ArmJson['visual'], { source: 'mesh' }>).model!.upAxis = v; })} options={[{ value: 'y', label: 'Y up' }, { value: 'z', label: 'Z up' }]} /></div>
                </>
              )}
            </fieldset>
          </>
        )}
        <h3>Safety geometry</h3>
        <Field label="Link collision radius (mm), base → tip"><Text mono value={j.linkRadius.join(', ')} onChange={(v) => up((a) => { a.linkRadius = v.split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x) && x > 0); })} /></Field>
        <Field label="Top tool speed (mm/s)"><Num value={j.maxTcpSpeed} onChange={(v) => up((a) => { a.maxTcpSpeed = v ?? 1000; })} /></Field>
        <details className="st-json"><summary>Full arm JSON (kinematics, limits, gripper)</summary><Area mono rows={16} value={pretty(j)} onChange={(v) => { try { setJ(JSON.parse(v)); } catch { /* keep typing */ } }} /></details>
      </aside>
    </>
  );
}
