/** Studio: build an environment (scene) — fixtures, parts, your own models, conveyors, I/O, named positions, camera. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ARMS, SCENES, SceneZ } from '../content';
import type { ConveyorDef, FixtureDef, MeshRef, ObjectDef, Pose, RegionDef, SceneDef } from '../sim/types';
import { solveIK, restartSeeds } from '../sim/kinematics/ik';
import { poseToM4 } from '../sim/kinematics/arm';
import { Preview, type PreviewHandle } from './Preview';
import { Area, Check, Color, Field, Num, Select, Text, Vec3, tidy } from './fields';
import { pretty, saveFile } from './api';
import { modelSizeMm, defaultUnits, defaultUp } from '../view/meshes';
import { Icon } from '../ui/icons';
import { validateScene } from './validate';

export function newScene(id = 'my-scene'): SceneDef {
  return {
    id, title: 'My environment', environment: 'custom',
    fixtures: [{ id: 'table', kind: 'box', center: [250, 0, -20], size: [1400, 1200, 40], color: '#e9eef3', mount: true }],
    objects: [], regions: [], io: { inputs: [], outputs: [] }, conveyors: [], sceneTargets: {},
    camera: { position: [1650, -1450, 1150], target: [260, -20, 280] },
  };
}

type Sel = `${'fixture' | 'object' | 'region' | 'conveyor' | 'target'}:${string}` | 'general' | 'io';
const uniq = (base: string, taken: string[]) => { let i = 1, n = base; while (taken.includes(n)) n = `${base}${++i}`; return n; };
const DOWN = { rx: 180, ry: 0, rz: 0 };

export function SceneEditor({ sourceId, models, onSaved }: { sourceId: string | null; models: string[]; onSaved(id: string): void }) {
  const isNew = !sourceId || !SCENES[sourceId];
  const [d, setD] = useState<SceneDef>(() => (sourceId && SCENES[sourceId] ? structuredClone(SCENES[sourceId]) : newScene(uniq('my-scene', Object.keys(SCENES)))));
  const [sel, setSel] = useState<Sel>('general');
  const [armId, setArmId] = useState('gofa-like');
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const pv = useRef<PreviewHandle>(null);
  const meshFiles = models.filter((m) => !m.endsWith('.urdf'));
  const ids = [...d.fixtures.map((f) => f.id), ...d.objects.map((o) => o.id), ...d.regions.map((r) => r.id)];
  const idsOf = { fixture: d.fixtures.map((f) => f.id), object: d.objects.map((o) => o.id), region: d.regions.map((r) => r.id) };
  const up = (fn: (s: SceneDef) => void) => setD((prev) => { const n = structuredClone(prev); fn(n); return n; });

  // ---------- selection helpers
  const [kind, key] = sel.includes(':') ? (sel.split(/:(.*)/s) as [string, string]) : [sel, ''];
  const fixture = kind === 'fixture' ? d.fixtures.find((f) => f.id === key) : undefined;
  const object = kind === 'object' ? d.objects.find((o) => o.id === key) : undefined;
  const region = kind === 'region' ? d.regions.find((r) => r.id === key) : undefined;
  const conveyor = kind === 'conveyor' ? d.conveyors.find((c) => c.id === key) : undefined;
  const target = kind === 'target' ? d.sceneTargets[key] : undefined;
  const selPos: [number, number, number] | null = fixture?.center ?? object?.position ?? region?.center ?? (target ? [target.x, target.y, target.z] : null);
  const onMove = (p: [number, number, number]) => up((s) => {
    if (kind === 'fixture') { const f = s.fixtures.find((x) => x.id === key); if (f) f.center = p; }
    if (kind === 'object') { const o = s.objects.find((x) => x.id === key); if (o) o.position = p; }
    if (kind === 'region') { const r = s.regions.find((x) => x.id === key); if (r) r.center = p; }
    if (kind === 'target') { const t = s.sceneTargets[key]; if (t) Object.assign(t, { x: p[0], y: p[1], z: p[2] }); }
  });

  // ---------- reachability of named positions with the preview arm
  const reach = useMemo(() => {
    const arm = ARMS[armId]; const out: Record<string, boolean> = {};
    if (!arm) return out;
    const seeds = [arm.home, ...restartSeeds(arm, 6)];
    for (const [n, p] of Object.entries(d.sceneTargets)) { const M = poseToM4(p); out[n] = seeds.some((sd) => solveIK(arm, M, sd).ok); }
    return out;
  }, [d.sceneTargets, armId]);

  // ---------- adders
  const addFixture = (k: FixtureDef['kind']) => {
    const id = uniq(k === 'model' ? 'model' : k, ids);
    const f: FixtureDef = k === 'bin' ? { id, kind: 'bin', center: [350, 300, 60], size: [220, 220, 120], wall: 8, color: '#f59e0b', label: 'Bin' }
      : k === 'rack' ? { id, kind: 'rack', center: [350, 300, 40], size: [200, 120, 80], wall: 6, color: '#dfe7ef' }
      : k === 'model' ? { id, kind: 'model', center: [500, 300, 150], size: [300, 300, 300], mesh: meshFiles[0] ? { file: meshFiles[0] } : undefined }
      : { id, kind: 'box', center: [450, 250, 25], size: [200, 200, 50], color: '#9fb4c8' };
    up((s) => { s.fixtures.push(f); }); setSel(`fixture:${id}`);
  };
  const addObject = (shape: 'box' | 'cylinder') => {
    const id = uniq(shape === 'box' ? 'part' : 'cup', ids);
    const o: ObjectDef = shape === 'box' ? { id, kind: 'part', shape, size: [50, 50, 50], position: [450, 0, 0], color: 'blue', graspable: true }
      : { id, kind: 'cup', shape, size: [60, 60, 90], position: [450, 0, 0], color: 'white', graspable: true };
    up((s) => { s.objects.push(o); }); setSel(`object:${id}`);
  };
  const addRegion = () => { const id = uniq('zone', ids); up((s) => { s.regions.push({ id, center: [450, 250, 50], size: [150, 150, 100], label: 'Zone' }); }); setSel(`region:${id}`); };
  const addConveyor = () => {
    const id = uniq('infeed', d.conveyors.map((c) => c.id));
    up((s) => {
      const c: ConveyorDef = { id, start: [-180, -420, 80], end: [450, -420, 80], speed: 150, runOutput: 'conveyor_run', sensorInput: 'part_present', spawn: { intervalSec: 5, jitterSec: 0, count: 3, colors: ['blue'], size: [50, 50, 50], kind: 'part' } };
      s.conveyors.push(c);
      s.fixtures.push(beltFor(c));
      if (!s.io.inputs.some((i) => i.name === 'part_present')) s.io.inputs.push({ name: 'part_present', initial: false });
      if (!s.io.outputs.some((o) => o.name === 'conveyor_run')) s.io.outputs.push({ name: 'conveyor_run', initial: true });
    });
    setSel(`conveyor:${id}`);
  };
  const addTarget = (name = uniq('point', Object.keys(d.sceneTargets)), pose: Pose = { x: 450, y: 0, z: 200, ...DOWN }) => { up((s) => { s.sceneTargets[name] = pose; }); setSel(`target:${name}`); };
  const pickTargets = (o: ObjectDef) => up((s) => {
    const z = o.position[2] + o.size[2] / 2;
    s.sceneTargets[o.id] = { x: o.position[0], y: o.position[1], z, ...DOWN };
    s.sceneTargets[`${o.id}.approach`] = { x: o.position[0], y: o.position[1], z: z + 120, ...DOWN };
  });
  const placeTargets = (r: RegionDef) => up((s) => {
    const bottom = r.center[2] - r.size[2] / 2;
    s.sceneTargets[`${r.id}.place`] = { x: r.center[0], y: r.center[1], z: bottom + 26, ...DOWN };
    s.sceneTargets[`${r.id}.approach`] = { x: r.center[0], y: r.center[1], z: bottom + 180, ...DOWN };
  });
  const remove = () => {
    up((s) => {
      if (kind === 'fixture') s.fixtures = s.fixtures.filter((f) => f.id !== key);
      if (kind === 'object') s.objects = s.objects.filter((f) => f.id !== key);
      if (kind === 'region') s.regions = s.regions.filter((f) => f.id !== key);
      if (kind === 'conveyor') { s.conveyors = s.conveyors.filter((f) => f.id !== key); s.fixtures = s.fixtures.filter((f) => f.id !== `${key}_belt`); }
      if (kind === 'target') delete s.sceneTargets[key];
    });
    setSel('general');
  };

  // ---------- validation + save
  const problems = useMemo(() => validateScene(d), [d]);
  const save = async () => {
    const clean = tidy(d);
    const r = SceneZ.safeParse(clean);
    const errs = [...problems, ...(r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`))];
    if (previewErr) errs.push(`The simulator rejected this scene: ${previewErr}`);
    if (errs.length) { setMsg({ tone: 'bad', text: errs.slice(0, 6).join(' · ') }); return; }
    try {
      await saveFile(`content/scenes/${clean.id}.json`, pretty(clean));
      setMsg({ tone: 'good', text: `Saved content/scenes/${clean.id}.json` });
      onSaved(clean.id);
    } catch (e) { setMsg({ tone: 'bad', text: (e as Error).message }); }
  };
  useEffect(() => setMsg(null), [d]);

  const outline: [string, Sel, string][] = [
    ...d.fixtures.map((f) => ['Fixtures', `fixture:${f.id}` as Sel, `${f.id} · ${f.kind}`] as [string, Sel, string]),
    ...d.objects.map((o) => ['Parts', `object:${o.id}` as Sel, `${o.id} · ${o.kind}`] as [string, Sel, string]),
    ...d.regions.map((r) => ['Zones', `region:${r.id}` as Sel, r.id] as [string, Sel, string]),
    ...d.conveyors.map((c) => ['Conveyors', `conveyor:${c.id}` as Sel, c.id] as [string, Sel, string]),
    ...Object.keys(d.sceneTargets).map((n) => ['Positions', `target:${n}` as Sel, n] as [string, Sel, string]),
  ];
  const groups = ['Fixtures', 'Parts', 'Zones', 'Conveyors', 'Positions'];

  return (
    <div className="st-editor">
      <aside className="st-outline">
        <button className={`st-item ${sel === 'general' ? 'on' : ''}`} onClick={() => setSel('general')}><Icon.gear width={13} height={13} /> General & camera</button>
        <button className={`st-item ${sel === 'io' ? 'on' : ''}`} onClick={() => setSel('io')}><Icon.plug width={13} height={13} /> Signals & sensors</button>
        {groups.map((g) => (
          <div key={g} className="st-group">
            <div className="st-group-h">{g}</div>
            {outline.filter((o) => o[0] === g).map(([, s, label]) => (
              <button key={s} className={`st-item ${sel === s ? 'on' : ''}`} onClick={() => setSel(s)}>
                {label}{g === 'Positions' && <span className={`reach ${reach[s.slice(7)] ? 'ok' : 'bad'}`} title={reach[s.slice(7)] ? 'Reachable by the preview arm' : 'Not reachable by the preview arm'}>{reach[s.slice(7)] ? <Icon.check width={10} height={10} /> : <Icon.x width={10} height={10} />}</span>}
              </button>
            ))}
          </div>
        ))}
        <div className="st-add">
          <div className="st-group-h">Add</div>
          <div className="st-add-grid">
            <button onClick={() => addFixture('box')}>Box / table</button><button onClick={() => addFixture('bin')}>Bin</button>
            <button onClick={() => addFixture('rack')}>Rack</button><button onClick={() => addFixture('model')}>3D model</button>
            <button onClick={() => addObject('box')}>Box part</button><button onClick={() => addObject('cylinder')}>Cylinder part</button>
            <button onClick={addRegion}>Zone</button><button onClick={addConveyor}>Conveyor</button>
            <button onClick={() => addTarget()}>Position</button>
          </div>
        </div>
      </aside>

      <section className="st-center">
        <div className="st-toolbar">
          <span className="muted">Preview arm</span>
          <Select value={armId} onChange={setArmId} options={Object.values(ARMS).map((a) => ({ value: a.id, label: a.name }))} />
          <span className="muted small">Click an item to select it · drag the arrows to move it</span>
          <span className="grow" />
          {problems.length > 0 && <span className="chip amber" title={problems.join('\n')}>{problems.length} issue{problems.length > 1 ? 's' : ''}</span>}
          <button className="btn aqua" onClick={save}>Save environment</button>
        </div>
        <Preview ref={pv} scene={d} arm={ARMS[armId]} selected={sel.includes(':') && kind !== 'conveyor' ? sel : null} selectedPos={selPos}
          onPick={(id) => setSel((id as Sel) ?? 'general')} onMove={onMove} onError={setPreviewErr} />
        {msg && <div className={`st-msg ${msg.tone}`}>{msg.text}</div>}
      </section>

      <aside className="st-inspector">
        {sel === 'general' && (
          <>
            <h3>Environment</h3>
            <Field label="File id" hint={isNew ? 'lowercase-with-dashes; becomes content/scenes/<id>.json' : 'existing environments keep their id (tasks refer to it)'}>
              {isNew ? <Text mono value={d.id} onChange={(v) => up((s) => { s.id = v; })} /> : <code>{d.id}</code>}
            </Field>
            <Field label="Title"><Text value={d.title} onChange={(v) => up((s) => { s.title = v; })} /></Field>
            <Field label="Look"><Select value={d.environment} onChange={(v) => up((s) => { s.environment = v; })} options={['factory', 'warehouse', 'kitchen', 'lab', 'custom']} /></Field>
            <Field label="Starting camera" hint="mm; or frame the view in the preview and capture it">
              <Vec3 value={d.camera?.position} onChange={(v) => up((s) => { s.camera = { target: s.camera?.target ?? [250, 0, 250], position: v }; })} />
              <Vec3 value={d.camera?.target} onChange={(v) => up((s) => { s.camera = { position: s.camera?.position ?? [1600, -1400, 1100], target: v }; })} />
              <button className="btn sm" onClick={() => { const c = pv.current?.camera(); if (c) up((s) => { s.camera = c; }); }}><Icon.camera width={12} height={12} /> Use the current view</button>
            </Field>
            <p className="st-help">The table marked <b>mount</b> is what the robot stands on (its top is z = 0). Units are millimeters; the robot base is at the origin, X forward, Z up.</p>
            <RobotsField value={d.robots} onChange={(r) => up((s) => { if (r) s.robots = r; else delete s.robots; })} />
          </>
        )}

        {sel === 'io' && (
          <>
            <h3>Signals</h3>
            {(['inputs', 'outputs'] as const).map((side) => (
              <Field key={side} label={side === 'inputs' ? 'Inputs (sensors → program)' : 'Outputs (program → cell)'} wide>
                {d.io[side].map((s, i) => (
                  <div className="row" key={i}>
                    <Text mono value={s.name} onChange={(v) => up((x) => { x.io[side][i].name = v; })} />
                    <Select value={String(s.initial)} onChange={(v) => up((x) => { x.io[side][i].initial = v === 'true' ? true : v === 'false' ? false : v; })} options={['false', 'true', 'none']} />
                    <button className="icon-btn" aria-label="Remove signal" onClick={() => up((x) => { x.io[side].splice(i, 1); })}><Icon.x width={12} height={12} /></button>
                  </div>
                ))}
                <button className="btn sm" onClick={() => up((x) => { x.io[side].push({ name: uniq(side === 'inputs' ? 'sensor' : 'output', x.io[side].map((y) => y.name)), initial: false }); })}><Icon.plus width={12} height={12} /> Add</button>
              </Field>
            ))}
            <h3>Sensors</h3>
            {(['presenceSensors', 'colorSensors'] as const).map((k) => (
              <Field key={k} label={k === 'presenceSensors' ? 'Presence sensors (input true when a part is in the zone)' : 'Color sensors (input = color of the part in the zone)'} wide>
                {(d[k] ?? []).map((s, i) => (
                  <div className="row" key={i}>
                    <Select value={s.input} onChange={(v) => up((x) => { x[k]![i].input = v; })} options={d.io.inputs.map((y) => y.name)} allowEmpty="input…" />
                    <Select value={s.region} onChange={(v) => up((x) => { x[k]![i].region = v; })} options={d.regions.map((r) => r.id)} allowEmpty="zone…" />
                    <button className="icon-btn" aria-label="Remove sensor" onClick={() => up((x) => { x[k]!.splice(i, 1); })}><Icon.x width={12} height={12} /></button>
                  </div>
                ))}
                <button className="btn sm" onClick={() => up((x) => { (x[k] ??= []).push({ input: x.io.inputs[0]?.name ?? '', region: x.regions[0]?.id ?? '' }); })}><Icon.plus width={12} height={12} /> Add</button>
              </Field>
            ))}
          </>
        )}

        {fixture && (
          <>
            <h3>Fixture</h3>
            <IdField value={fixture.id} taken={idsOf.fixture} onChange={(v) => { up((s) => { s.fixtures.find((f) => f.id === key)!.id = v; }); setSel(`fixture:${v}`); }} />
            <Field label="Kind"><Select value={fixture.kind} onChange={(v) => up((s) => { s.fixtures.find((f) => f.id === key)!.kind = v; })} options={['box', 'bin', 'rack', 'model', 'region', 'conveyor']} /></Field>
            <Field label="Center (mm)"><Vec3 value={fixture.center} onChange={(v) => up((s) => { s.fixtures.find((f) => f.id === key)!.center = v; })} /></Field>
            <Field label="Size (mm)" hint={fixture.mesh ? 'collision box — the robot collides with this, not the model' : undefined}><Vec3 value={fixture.size} onChange={(v) => up((s) => { s.fixtures.find((f) => f.id === key)!.size = v; })} /></Field>
            <Field label="Turn (yaw, deg)"><Num value={fixture.yaw} onChange={(v) => up((s) => { s.fixtures.find((f) => f.id === key)!.yaw = v; })} /></Field>
            <Field label="Color"><Color value={fixture.color} onChange={(v) => up((s) => { s.fixtures.find((f) => f.id === key)!.color = v; })} /></Field>
            <Field label="Label"><Text value={fixture.label} onChange={(v) => up((s) => { s.fixtures.find((f) => f.id === key)!.label = v || undefined; })} /></Field>
            {(fixture.kind === 'bin' || fixture.kind === 'rack') && <Field label="Wall (mm)"><Num value={fixture.wall} onChange={(v) => up((s) => { s.fixtures.find((f) => f.id === key)!.wall = v; })} /></Field>}
            <Check label="Robot is mounted on this" value={fixture.mount} onChange={(v) => up((s) => { s.fixtures.find((f) => f.id === key)!.mount = v || undefined; })} />
            <Check label="Decoration only (no collision)" value={fixture.visualOnly} onChange={(v) => up((s) => { s.fixtures.find((f) => f.id === key)!.visualOnly = v || undefined; })} />
            {fixture.kind !== 'conveyor' && <MeshField files={meshFiles} value={fixture.mesh} onChange={(m) => up((s) => { s.fixtures.find((f) => f.id === key)!.mesh = m; })}
              onFit={(size) => up((s) => { s.fixtures.find((f) => f.id === key)!.size = size; })} />}
          </>
        )}

        {object && (
          <>
            <h3>Part</h3>
            <IdField value={object.id} taken={idsOf.object} onChange={(v) => { up((s) => { s.objects.find((o) => o.id === key)!.id = v; }); setSel(`object:${v}`); }} />
            <Field label="Kind" hint="a word goals can count by, e.g. part, cup, tube"><Text value={object.kind} onChange={(v) => up((s) => { s.objects.find((o) => o.id === key)!.kind = v; })} /></Field>
            <Field label="Shape (for gripping and collision)"><Select value={object.shape} onChange={(v) => up((s) => { s.objects.find((o) => o.id === key)!.shape = v; })} options={['box', 'cylinder']} /></Field>
            <Field label="Size (mm)" hint={object.shape === 'cylinder' ? 'diameter, diameter, height' : undefined}><Vec3 value={object.size} onChange={(v) => up((s) => { s.objects.find((o) => o.id === key)!.size = v; })} /></Field>
            <Field label="Position (mm, bottom center)"><Vec3 value={object.position} onChange={(v) => up((s) => { s.objects.find((o) => o.id === key)!.position = v; })} /></Field>
            <Field label="Turn (yaw, deg)"><Num value={object.yaw} onChange={(v) => up((s) => { s.objects.find((o) => o.id === key)!.yaw = v; })} /></Field>
            <Field label="Color" hint="color sensors and sorting goals use this name"><Select value={object.color} onChange={(v) => up((s) => { s.objects.find((o) => o.id === key)!.color = v; })} options={['red', 'green', 'blue', 'yellow', 'orange', 'purple', 'white', 'black']} /></Field>
            <Check label="Can be picked up" value={object.graspable !== false} onChange={(v) => up((s) => { s.objects.find((o) => o.id === key)!.graspable = v; })} />
            <Check label="Holds liquid (cup / pitcher)" value={!!object.container} onChange={(v) => up((s) => { s.objects.find((o) => o.id === key)!.container = v ? { capacity: 250, fill: 0 } : undefined; })} />
            {object.container && <Field label="Fill (0–1)"><Num step={0.1} min={0} max={1} value={object.container.fill} onChange={(v) => up((s) => { s.objects.find((o) => o.id === key)!.container!.fill = v ?? 0; })} /></Field>}
            <MeshField files={meshFiles} value={object.mesh} onChange={(m) => up((s) => { s.objects.find((o) => o.id === key)!.mesh = m; })}
              onFit={(size) => up((s) => { s.objects.find((o) => o.id === key)!.size = size; })} />
            <button className="btn sm" onClick={() => pickTargets(object)}><Icon.target width={12} height={12} /> Add pick positions ({object.id}, {object.id}.approach)</button>
          </>
        )}

        {region && (
          <>
            <h3>Zone</h3>
            <p className="st-help">An invisible box that goals and sensors check (“part is in zone”).</p>
            <IdField value={region.id} taken={idsOf.region} onChange={(v) => { up((s) => { s.regions.find((r) => r.id === key)!.id = v; }); setSel(`region:${v}`); }} />
            <Field label="Center (mm)"><Vec3 value={region.center} onChange={(v) => up((s) => { s.regions.find((r) => r.id === key)!.center = v; })} /></Field>
            <Field label="Size (mm)"><Vec3 value={region.size} onChange={(v) => up((s) => { s.regions.find((r) => r.id === key)!.size = v; })} /></Field>
            <Field label="Label"><Text value={region.label} onChange={(v) => up((s) => { s.regions.find((r) => r.id === key)!.label = v || undefined; })} /></Field>
            <button className="btn sm" onClick={() => placeTargets(region)}><Icon.target width={12} height={12} /> Add place positions</button>
          </>
        )}

        {conveyor && (
          <>
            <h3>Conveyor</h3>
            <Field label="Start → sensor end (mm, belt top)"><Vec3 value={conveyor.start} onChange={(v) => up((s) => { const c = s.conveyors.find((x) => x.id === key)!; c.start = v; syncBelt(s, c); })} /><Vec3 value={conveyor.end} onChange={(v) => up((s) => { const c = s.conveyors.find((x) => x.id === key)!; c.end = v; syncBelt(s, c); })} /></Field>
            <Field label="Speed (mm/s)"><Num value={conveyor.speed} onChange={(v) => up((s) => { s.conveyors.find((x) => x.id === key)!.speed = v ?? 100; })} /></Field>
            <Field label="Runs while output is true"><Select value={conveyor.runOutput} onChange={(v) => up((s) => { s.conveyors.find((x) => x.id === key)!.runOutput = v; })} options={d.io.outputs.map((o) => o.name)} /></Field>
            <Field label="Part-waiting input"><Select value={conveyor.sensorInput} onChange={(v) => up((s) => { s.conveyors.find((x) => x.id === key)!.sensorInput = v; })} options={d.io.inputs.map((o) => o.name)} /></Field>
            <Field label="Color input (optional)"><Select value={conveyor.colorInput} allowEmpty="none" onChange={(v) => up((s) => { s.conveyors.find((x) => x.id === key)!.colorInput = v || undefined; })} options={d.io.inputs.map((o) => o.name)} /></Field>
            <h3>Parts it brings</h3>
            {(() => { const sp = conveyor.spawn; const set = (fn: (x: ConveyorDef['spawn']) => void) => up((s) => fn(s.conveyors.find((x) => x.id === key)!.spawn)); return (<>
              <Field label="How many · every (s) · jitter (s)"><span className="row"><Num value={sp.count} onChange={(v) => set((x) => { x.count = v ?? 1; })} /><Num value={sp.intervalSec} onChange={(v) => set((x) => { x.intervalSec = v ?? 5; })} /><Num value={sp.jitterSec} onChange={(v) => set((x) => { x.jitterSec = v ?? 0; })} /></span></Field>
              <Field label="Colors (cycled, comma separated)"><Text value={sp.colors.join(', ')} onChange={(v) => set((x) => { x.colors = v.split(',').map((c) => c.trim()).filter(Boolean); })} /></Field>
              <Field label="Kind · shape"><span className="row"><Text value={sp.kind} onChange={(v) => set((x) => { x.kind = v; })} /><Select value={sp.shape ?? 'box'} onChange={(v) => set((x) => { x.shape = v; })} options={['box', 'cylinder']} /></span></Field>
              <Field label="Size (mm)"><Vec3 value={sp.size} onChange={(v) => set((x) => { x.size = v; })} /></Field>
              <Check label="First part already waiting at the sensor" value={sp.prefill !== false} onChange={(v) => set((x) => { x.prefill = v ? undefined : false; })} />
              <MeshField files={meshFiles} value={sp.mesh} onChange={(m) => set((x) => { x.mesh = m; })} onFit={(size) => set((x) => { x.size = size; })} />
            </>); })()}
            <button className="btn sm" onClick={() => up((s) => { const c = s.conveyors.find((x) => x.id === key)!; const z = c.end[2] + c.spawn.size[2] / 2; s.sceneTargets.pick = { x: c.end[0], y: c.end[1], z, ...DOWN }; s.sceneTargets['pick.approach'] = { x: c.end[0], y: c.end[1], z: z + 125, ...DOWN }; })}>
              <Icon.target width={12} height={12} /> Add pick positions at the sensor</button>
          </>
        )}

        {target && (
          <>
            <h3>Named position</h3>
            <Field label="Name" hint="programs use this, e.g. robot.moveJ('pick')">
              <Text mono value={key} onChange={(v) => { if (!v || d.sceneTargets[v]) return; up((s) => { s.sceneTargets[v] = s.sceneTargets[key]; delete s.sceneTargets[key]; }); setSel(`target:${v}`); }} />
            </Field>
            <Field label="Position (mm)"><Vec3 value={[target.x, target.y, target.z]} onChange={(v) => up((s) => { Object.assign(s.sceneTargets[key], { x: v[0], y: v[1], z: v[2] }); })} /></Field>
            <Field label="Tool rotation (deg)" hint="rx 180 = gripper pointing down"><Vec3 labels={['rx', 'ry', 'rz']} value={[target.rx, target.ry, target.rz]} onChange={(v) => up((s) => { Object.assign(s.sceneTargets[key], { rx: v[0], ry: v[1], rz: v[2] }); })} /></Field>
            <div className={`chip ${reach[key] ? 'leaf' : 'rose'}`}>{reach[key] ? 'Reachable by the preview arm' : 'Not reachable by the preview arm'}</div>
          </>
        )}

        {sel.includes(':') && (fixture || object || region || conveyor || target) && <button className="btn sm ghost danger" onClick={remove}><Icon.trash width={12} height={12} /> Remove</button>}

        <details className="st-json"><summary>JSON</summary><Area mono rows={14} value={pretty(tidy(d))} onChange={(v) => { try { setD(JSON.parse(v)); } catch { /* keep typing */ } }} /></details>
      </aside>
    </div>
  );
}

/** Multi-arm cells (SPEC §21.2): the robots list as JSON. Each arm's targets are in its own base frame. */
function RobotsField({ value, onChange }: { value: SceneDef['robots']; onChange(v: SceneDef['robots']): void }) {
  const [text, setText] = useState(() => (value ? JSON.stringify(value, null, 1) : ''));
  const [err, setErr] = useState<string | null>(null);
  const commit = (t: string) => {
    if (!t.trim()) { setErr(null); onChange(undefined); return; }
    try {
      const v = JSON.parse(t);
      const r = SceneZ.shape.robots.safeParse(v);
      if (!r.success) { setErr(r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).slice(0, 3).join(' · ')); return; }
      for (const rb of r.data ?? []) if (!ARMS[rb.armId]) { setErr(`unknown arm ${rb.armId}`); return; }
      setErr(null); onChange(r.data);
    } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Field label="Arms (multi-arm cell, optional)" wide hint={err ?? 'Leave empty for a one-arm cell. Otherwise a JSON list: [{ "id": "A", "label": "Left arm", "armId": "gofa-like", "base": { "x": 0, "y": 400, "z": 0, "rz": 0 }, "color": "#1a8cff", "targets": { "pick": { "x": 450, "y": 0, "z": 100, "rx": 180, "ry": 0, "rz": 0 } } }, …]. Targets are measured from each arm’s base; the Positions list below is only used by one-arm cells.'}>
      <Area mono rows={value ? 10 : 3} value={text} onChange={(t) => { setText(t); commit(t); }} />
    </Field>
  );
}

function IdField({ value, taken, onChange }: { value: string; taken: string[]; onChange(v: string): void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const bad = v !== value && (taken.includes(v) || !/^[A-Za-z][\w.-]*$/.test(v));
  return <Field label="Id" hint={bad ? 'must be unique and start with a letter' : 'goals and positions refer to this'}><input className={`field mono ${bad ? 'bad' : ''}`} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { if (!bad && v !== value) onChange(v); else setV(value); }} /></Field>;
}

/** Choose one of your model files for a fixture/part, with units, orientation and an auto-fit collision size. */
function MeshField({ files, value, onChange, onFit }: { files: string[]; value: MeshRef | undefined; onChange(m: MeshRef | undefined): void; onFit(size: [number, number, number]): void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const m = value;
  const set = (p: Partial<MeshRef>) => onChange({ ...(m as MeshRef), ...p });
  return (
    <fieldset className="st-mesh">
      <legend>3D model</legend>
      <Select value={m?.file} allowEmpty="none (simple shape)" onChange={(f) => onChange(f ? { file: f } : undefined)} options={files} />
      {!files.length && <p className="st-help">Put .glb, .gltf, .obj, .stl or .dae files in <code>public/models/</code> and they appear here.</p>}
      {m && (
        <>
          <Field label="Units in the file"><Select value={m.units ?? defaultUnits(m.file)} onChange={(v) => set({ units: v })} options={['m', 'cm', 'mm', 'in']} /></Field>
          <Field label="Up axis in the file"><Select value={m.upAxis ?? defaultUp(m.file)} onChange={(v) => set({ upAxis: v })} options={[{ value: 'y', label: 'Y up (glTF, Blender, most tools)' }, { value: 'z', label: 'Z up (CAD, ROS)' }]} /></Field>
          <Field label="Extra scale"><Num step={0.1} value={m.scale ?? 1} onChange={(v) => set({ scale: v === 1 ? undefined : v })} /></Field>
          <Field label="Rotate (deg)"><Vec3 labels={['rx', 'ry', 'rz']} value={m.rotation} onChange={(v) => set({ rotation: v.some((x) => x) ? v : undefined })} /></Field>
          <Field label="Nudge (mm)"><Vec3 value={m.offset} onChange={(v) => set({ offset: v.some((x) => x) ? v : undefined })} /></Field>
          <Field label="Tint"><Color value={m.color} onChange={(v) => set({ color: v })} /></Field>
          <button className="btn sm" disabled={busy} onClick={async () => { setBusy(true); setErr(''); try { onFit(await modelSizeMm(m)); } catch (e) { setErr((e as Error).message || 'Could not load the model'); } setBusy(false); }}>
            <Icon.move width={12} height={12} /> {busy ? 'Measuring…' : 'Fit collision size to the model'}</button>
          {err && <div className="chip rose">{err}</div>}
        </>
      )}
    </fieldset>
  );
}

function beltFor(c: ConveyorDef): FixtureDef {
  const len = Math.hypot(c.end[0] - c.start[0], c.end[1] - c.start[1]) + 130;
  const yaw = (Math.atan2(c.end[1] - c.start[1], c.end[0] - c.start[0]) * 180) / Math.PI;
  return { id: `${c.id}_belt`, kind: 'conveyor', center: [(c.start[0] + c.end[0]) / 2, (c.start[1] + c.end[1]) / 2, c.end[2] - 40], size: [Math.round(len), 170, 80], color: '#3d4652', ...(Math.abs(yaw) > 0.5 ? { yaw: Math.round(yaw) } : {}) };
}
function syncBelt(s: SceneDef, c: ConveyorDef) {
  const i = s.fixtures.findIndex((f) => f.id === `${c.id}_belt`);
  if (i >= 0) s.fixtures[i] = { ...s.fixtures[i], ...beltFor(c), color: s.fixtures[i].color };
}
