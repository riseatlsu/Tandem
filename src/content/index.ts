import { z } from 'zod';
import { buildArm } from '../sim/kinematics/arm';
import type { ArmDef, ArmJson, PredicateDef, Pose, SceneDef, ConveyorDef } from '../sim/types';
import type { RobotSetup } from '../sim/SimCore';

const armFiles = import.meta.glob('../../content/arms/*.json', { eager: true, import: 'default' });
const sceneFiles = import.meta.glob('../../content/scenes/*.json', { eager: true, import: 'default' });
const taskFiles = import.meta.glob('../../content/tasks/*.json', { eager: true, import: 'default' });
const experimentFiles = import.meta.glob('../../content/experiments/*.json', { eager: true, import: 'default' });

const PoseZ = z.object({ x: z.number(), y: z.number(), z: z.number(), rx: z.number(), ry: z.number(), rz: z.number() });
const V3Z = z.tuple([z.number(), z.number(), z.number()]);

export const MeshRefZ = z.object({
  file: z.string().regex(/^models\/[\w\-./ ]+\.(glb|gltf|obj|stl|dae)$/i, 'must be a .glb/.gltf/.obj/.stl/.dae file under models/'),
  units: z.enum(['m', 'cm', 'mm', 'in']).optional(), scale: z.number().positive().optional(), upAxis: z.enum(['z', 'y']).optional(),
  offset: V3Z.optional(), rotation: V3Z.optional(), color: z.string().optional(),
});
const IdZ = z.string().regex(/^[A-Za-z][\w.-]*$/, 'letters, digits, _ . - (start with a letter)');

export const SceneZ = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes'), title: z.string().min(1), environment: z.enum(['factory', 'warehouse', 'kitchen', 'lab', 'custom']),
  fixtures: z.array(z.object({ id: IdZ, kind: z.enum(['box', 'bin', 'conveyor', 'rack', 'region', 'model']), center: V3Z, size: V3Z, yaw: z.number().optional(), color: z.string().optional(), label: z.string().optional(), wall: z.number().optional(), mount: z.boolean().optional(), visualOnly: z.boolean().optional(), mesh: MeshRefZ.optional() })),
  objects: z.array(z.object({ id: IdZ, kind: z.string(), shape: z.enum(['box', 'cylinder']), size: V3Z, position: V3Z, yaw: z.number().optional(), color: z.string().optional(), graspable: z.boolean().optional(), container: z.object({ capacity: z.number(), fill: z.number() }).optional(), mesh: MeshRefZ.optional(), twoHanded: z.boolean().optional() })),
  regions: z.array(z.object({ id: z.string(), center: V3Z, size: V3Z, label: z.string().optional() })),
  io: z.object({ inputs: z.array(z.object({ name: z.string(), initial: z.union([z.boolean(), z.string()]) })), outputs: z.array(z.object({ name: z.string(), initial: z.union([z.boolean(), z.string()]) })) }),
  conveyors: z.array(z.object({
    id: z.string(), start: V3Z, end: V3Z, speed: z.number(), runOutput: z.string(), sensorInput: z.string(), colorInput: z.string().optional(),
    spawn: z.object({ intervalSec: z.number(), jitterSec: z.number(), count: z.number(), colors: z.array(z.string()), cycle: z.boolean().optional(), size: V3Z, kind: z.string(), shape: z.enum(['box', 'cylinder']).optional(), prefill: z.boolean().optional(), mesh: MeshRefZ.optional() }),
  })),
  sceneTargets: z.record(z.string(), PoseZ),
  colorSensors: z.array(z.object({ input: z.string(), region: z.string() })).optional(),
  presenceSensors: z.array(z.object({ input: z.string(), region: z.string() })).optional(),
  camera: z.object({ position: V3Z, target: V3Z }).optional(),
  /** Multi-arm cells (SPEC §21.2): one entry per arm; each arm's targets are in its own base frame. */
  robots: z.array(z.object({
    id: z.string().regex(/^[A-Z][A-Za-z0-9]*$/, 'a capital letter, then letters/digits (A, B, …)'), label: z.string().min(1), armId: z.string(),
    base: z.object({ x: z.number(), y: z.number(), z: z.number(), rz: z.number() }), color: z.string().optional(),
    targets: z.record(z.string(), PoseZ).optional(),
  })).min(1).optional(),
}).superRefine((s, ctx) => {
  const ids = (s.robots ?? []).map((r) => r.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['robots'], message: 'robot ids must be unique' });
});

const PredZ = z.object({ type: z.string() }).passthrough();
export const TaskZ = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes'), title: z.string(), brief: z.string(), sceneId: z.string(), armId: z.string().optional(), seed: z.number(),
  editor: z.enum(['blocks', 'code']), passOn: z.enum(['run', 'live']).default('run'),
  /** Starting program: `code` (code tasks), or `steps` (a block program in the JSON steps format: partial to finish, or buggy to fix). `blocks` is the old list-of-types form. */
  starter: z.object({ code: z.string().optional(), blocks: z.array(z.any()).optional(), steps: z.array(z.record(z.string(), z.any())).optional() }).optional(),
  presetTargets: z.record(z.string(), PoseZ).optional(),
  predicates: z.array(PredZ),
  maxSimTimeSec: z.number().optional(), timeLimitSec: z.number().optional(),
  hints: z.array(z.string()).optional(),
  conveyorOverrides: z.record(z.string(), z.object({}).passthrough()).optional(),
  /** Listed in the demo (level bubbles + landing gallery) at this position; tasks without it are study-only. */
  demo: z.object({ order: z.number() }).optional(),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
});
/** `armId` is always filled after loading: multi-arm tasks get their first robot's arm (SPEC §21.2). */
export type TaskDef = Omit<z.infer<typeof TaskZ>, 'predicates' | 'presetTargets' | 'armId'> & { armId: string; predicates: PredicateDef[]; presetTargets?: Record<string, Pose> };

export const ExperimentZ = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'lowercase letters, digits and dashes'), version: z.string(),
  conditions: z.record(z.string(), z.object({
    agent: z.object({
      mode: z.enum(['off', 'qa', 'suggest']), model: z.string().optional(), promptVersion: z.string(),
      // AI-partner features for this condition; anything left out is off
      features: z.object({ visuals: z.boolean().default(false), plans: z.boolean().default(false), preview: z.boolean().default(false) }).partial().optional(),
    }),
    tour: z.boolean().optional(),
    taskSequence: z.array(z.string()),
  })),
  assignment: z.literal('byCode'),
  counterbalance: z.object({ method: z.literal('latinSquare'), over: z.literal('taskSequence'), fixedPrefix: z.number().optional() }).optional(),
  postSurveyUrl: z.string().optional(),
  logging: z.object({ telemetry: z.boolean(), snapshotDebounceMs: z.number() }),
});
export type ExperimentDef = z.infer<typeof ExperimentZ>;

function load<T>(files: Record<string, unknown>, schema: z.ZodType, what: string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [path, raw] of Object.entries(files)) {
    const r = schema.safeParse(raw);
    if (!r.success) throw new Error(`Invalid ${what} ${path}: ${r.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}`);
    out[(r.data as { id: string }).id] = r.data as T;
  }
  return out;
}

export const ARMS: Record<string, ArmDef> = Object.fromEntries(Object.values(armFiles).map((j) => { const a = buildArm(j as ArmJson); return [a.id, a]; }));
export const SCENES: Record<string, SceneDef> = load<SceneDef>(sceneFiles, SceneZ, 'scene');
export const TASKS: Record<string, TaskDef> = load<TaskDef>(taskFiles, TaskZ, 'task');
for (const t of Object.values(TASKS)) {
  const robots = SCENES[t.sceneId]?.robots;
  if (robots) {
    if (t.armId) throw new Error(`Invalid task ${t.id}: multi-arm tasks set their arms in the scene, not armId`);
    t.armId = robots[0].armId;
  } else if (!t.armId) throw new Error(`Invalid task ${t.id}: armId is required for single-arm scenes`);
  for (const r of robots ?? []) if (!ARMS[r.armId]) throw new Error(`Invalid scene ${t.sceneId}: unknown arm ${r.armId}`);
}
export const EXPERIMENTS: Record<string, ExperimentDef> = load<ExperimentDef>(experimentFiles, ExperimentZ, 'experiment');

/** Demo level list: tasks with a `demo` entry, by `demo.order`. Study sequences come from experiments instead. */
export const DEMO_TASKS: string[] = Object.values(TASKS).filter((t) => t.demo).sort((a, b) => a.demo!.order - b.demo!.order || a.id.localeCompare(b.id)).map((t) => t.id);

/**
 * The robots of a scene for SimCore: every `robots` entry for multi-arm cells, otherwise one robot "A" using
 * `armId` (the task's arm, or the demo's arm override) and the scene's `sceneTargets`.
 */
export function robotsFor(scene: SceneDef, armId: string): RobotSetup[] {
  if (scene.robots) return scene.robots.map((r) => ({ id: r.id, arm: ARMS[r.armId], base: r.base, label: r.label, color: r.color, targets: r.targets ?? {} }));
  const arm = ARMS[armId];
  if (!arm) throw new Error(`Unknown arm ${armId}`);
  return [{ id: 'A', arm, targets: scene.sceneTargets }];
}
export const isMultiArm = (task: TaskDef) => !!SCENES[task.sceneId]?.robots;

/** Scene with task-specific overrides applied (conveyor spawn tweaks). */
export function sceneForTask(task: TaskDef): SceneDef {
  const base = SCENES[task.sceneId];
  if (!base) throw new Error(`Task ${task.id}: unknown scene ${task.sceneId}`);
  const scene: SceneDef = structuredClone(base);
  for (const c of scene.conveyors) {
    const o = task.conveyorOverrides?.[c.id] as Partial<ConveyorDef['spawn']> | undefined;
    if (o) c.spawn = { ...c.spawn, ...o };
  }
  return scene;
}
