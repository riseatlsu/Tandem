import { z } from 'zod';
import { buildArm } from '../sim/kinematics/arm';
import type { ArmDef, ArmJson, PredicateDef, Pose, SceneDef, ConveyorDef } from '../sim/types';

const armFiles = import.meta.glob('../../content/arms/*.json', { eager: true, import: 'default' });
const sceneFiles = import.meta.glob('../../content/scenes/*.json', { eager: true, import: 'default' });
const taskFiles = import.meta.glob('../../content/tasks/*.json', { eager: true, import: 'default' });
const experimentFiles = import.meta.glob('../../content/experiments/*.json', { eager: true, import: 'default' });

const PoseZ = z.object({ x: z.number(), y: z.number(), z: z.number(), rx: z.number(), ry: z.number(), rz: z.number() });
const V3Z = z.tuple([z.number(), z.number(), z.number()]);

const SceneZ = z.object({
  id: z.string(), title: z.string(), environment: z.enum(['factory', 'warehouse', 'kitchen']),
  fixtures: z.array(z.object({ id: z.string(), kind: z.enum(['box', 'bin', 'conveyor', 'rack', 'region']), center: V3Z, size: V3Z, yaw: z.number().optional(), color: z.string().optional(), label: z.string().optional(), wall: z.number().optional(), mount: z.boolean().optional(), visualOnly: z.boolean().optional() })),
  objects: z.array(z.object({ id: z.string(), kind: z.string(), shape: z.enum(['box', 'cylinder']), size: V3Z, position: V3Z, yaw: z.number().optional(), color: z.string().optional(), graspable: z.boolean().optional(), container: z.object({ capacity: z.number(), fill: z.number() }).optional() })),
  regions: z.array(z.object({ id: z.string(), center: V3Z, size: V3Z, label: z.string().optional() })),
  io: z.object({ inputs: z.array(z.object({ name: z.string(), initial: z.union([z.boolean(), z.string()]) })), outputs: z.array(z.object({ name: z.string(), initial: z.union([z.boolean(), z.string()]) })) }),
  conveyors: z.array(z.object({
    id: z.string(), start: V3Z, end: V3Z, speed: z.number(), runOutput: z.string(), sensorInput: z.string(), colorInput: z.string().optional(),
    spawn: z.object({ intervalSec: z.number(), jitterSec: z.number(), count: z.number(), colors: z.array(z.string()), size: V3Z, kind: z.string(), shape: z.enum(['box', 'cylinder']).optional() }),
  })),
  sceneTargets: z.record(z.string(), PoseZ),
  colorSensors: z.array(z.object({ input: z.string(), region: z.string() })).optional(),
  presenceSensors: z.array(z.object({ input: z.string(), region: z.string() })).optional(),
  camera: z.object({ position: V3Z, target: V3Z }).optional(),
});

const PredZ = z.object({ type: z.string() }).passthrough();
const TaskZ = z.object({
  id: z.string(), title: z.string(), brief: z.string(), sceneId: z.string(), armId: z.string(), seed: z.number(),
  editor: z.enum(['blocks', 'code']), passOn: z.enum(['run', 'live']).default('run'),
  starter: z.object({ code: z.string().optional(), blocks: z.array(z.any()).optional() }).optional(),
  presetTargets: z.record(z.string(), PoseZ).optional(),
  predicates: z.array(PredZ),
  maxSimTimeSec: z.number().optional(), timeLimitSec: z.number().optional(),
  hints: z.array(z.string()).optional(),
  conveyorOverrides: z.record(z.string(), z.object({}).passthrough()).optional(),
});
export type TaskDef = Omit<z.infer<typeof TaskZ>, 'predicates' | 'presetTargets'> & { predicates: PredicateDef[]; presetTargets?: Record<string, Pose> };

const ExperimentZ = z.object({
  id: z.string(), version: z.string(),
  conditions: z.record(z.string(), z.object({
    agent: z.object({ mode: z.enum(['off', 'qa', 'suggest']), model: z.string().optional(), promptVersion: z.string() }),
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
export const EXPERIMENTS: Record<string, ExperimentDef> = load<ExperimentDef>(experimentFiles, ExperimentZ, 'experiment');

export const TASK_ORDER = ['tut-jog-teach', 'tut-first-program', 'factory-pick-one', 'factory-bin-three', 'sort-colors', 'palletize-2x2x2', 'kitchen-pour', 'lab-tubes'];

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
