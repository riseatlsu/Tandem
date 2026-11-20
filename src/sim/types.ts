import type { M4, V3 } from './math/mat4';

/** User-facing pose: mm and degrees, R = Rx(rx)·Ry(ry)·Rz(rz), in the robot base (= world) frame. */
export interface Pose { x: number; y: number; z: number; rx: number; ry: number; rz: number }

// ---------------- Arms ----------------
export interface ArmLink {
  name: string;
  /** local = pre · J(q) · post (column-major 4x4). */
  pre: number[];
  joint: null | { index: number; type: 'R' | 'P' };
  post: number[];
}
export interface DHRow { theta: number; d: number; a: number; alpha: number; type?: 'R' | 'P' }
export interface ArmJson {
  id: string;
  name: string;
  kind: 'articulated6' | 'scara4';
  /** Either DH rows (standard DH; converted to links) or an explicit link chain. */
  dh?: DHRow[];
  links?: ArmLink[];
  jointLimitsDeg: { min: number; max: number; maxVel: number }[]; // P joints: mm & mm/s
  /** Flange → TCP transform: translation mm, rotation deg. */
  tool: Pose;
  homeDeg: number[];
  maxTcpSpeed: number; // mm/s
  linkRadius: number[]; // collision capsule radius (mm) for segment between consecutive link origins
  visual:
    | { source: 'uaibot'; model: 'kuka_kr5' | 'epson_t6' }
    | { source: 'procedural'; color: string; accent: string };
  gripper: { stroke: number; graspTolerance: number; alignTolDeg: number };
  /** For SCARA: IK only constrains x,y,z,rz. */
  ikRows?: number[];
}
export interface ArmDef extends Omit<ArmJson, 'dh' | 'links'> {
  links: ArmLink[];
  dof: number;
  /** rad (R) or m (P) */
  limits: { min: number; max: number; maxVel: number }[];
  home: number[];
  toolM: M4;
}

// ---------------- Scenes ----------------
export interface FixtureDef {
  id: string;
  kind: 'box' | 'bin' | 'conveyor' | 'rack' | 'region';
  /** center (mm), yaw (deg); size = full extents (mm). bin: open-top container with wall thickness. */
  center: [number, number, number];
  size: [number, number, number];
  yaw?: number;
  color?: string;
  label?: string;
  wall?: number;
  /** robot is mounted on this; base links ignore it for collision */
  mount?: boolean;
  /** decorative only: no collision */
  visualOnly?: boolean;
}
export interface ObjectDef {
  id: string;
  kind: string; // e.g. 'part', 'cup', 'pitcher', 'tube', 'box'
  shape: 'box' | 'cylinder';
  size: [number, number, number]; // box: x,y,z ; cylinder: diameter, diameter, height (mm)
  position: [number, number, number]; // center of bottom face (mm)
  yaw?: number;
  color?: string;
  graspable?: boolean;
  container?: { capacity: number; fill: number };
}
export interface RegionDef { id: string; center: [number, number, number]; size: [number, number, number]; label?: string }
export interface ConveyorDef {
  id: string;
  start: [number, number, number]; // spawn point (mm, belt top surface)
  end: [number, number, number]; // sensor/stop point
  speed: number; // mm/s
  runOutput: string; // output name that runs the belt
  sensorInput: string; // input set true when a part waits at the end
  colorInput?: string; // optional input reporting the color at the sensor
  spawn: { intervalSec: number; jitterSec: number; count: number; colors: string[]; size: [number, number, number]; kind: string; shape?: 'box' | 'cylinder' };
}
export interface SceneDef {
  id: string;
  title: string;
  environment: 'factory' | 'warehouse' | 'kitchen';
  fixtures: FixtureDef[];
  objects: ObjectDef[];
  regions: RegionDef[];
  io: { inputs: { name: string; initial: boolean | string }[]; outputs: { name: string; initial: boolean | string }[] };
  conveyors: ConveyorDef[];
  sceneTargets: Record<string, Pose>;
  /** Static color sensors: input reports color of object whose center is within region, or 'none'. */
  colorSensors?: { input: string; region: string }[];
  presenceSensors?: { input: string; region: string }[];
  camera?: { position: [number, number, number]; target: [number, number, number] };
}

// ---------------- Targets ----------------
export interface Target { name: string; pose: Pose; q?: number[]; source: 'taught' | 'scene' | 'preset' }
export type TargetRef = string | Pose;

// ---------------- Commands & faults ----------------
export type RobotCommand =
  | { op: 'moveJ' | 'moveL'; target: TargetRef; speed?: number }
  | { op: 'moveJoints'; jointsDeg: number[]; speed?: number }
  | { op: 'home'; speed?: number }
  | { op: 'gripper'; action: 'open' | 'close' }
  | { op: 'wait'; ms: number }
  | { op: 'waitInput'; name: string; value: boolean | string; timeoutMs?: number }
  | { op: 'setOutput'; name: string; value: boolean | string }
  | { op: 'query'; what: 'pose' | 'joints' | 'input' | 'holding'; name?: string };

export type FaultCode =
  | 'UNREACHABLE' | 'JOINT_LIMIT' | 'SINGULARITY' | 'COLLISION' | 'INVALID_ARG'
  | 'TIMEOUT' | 'RUNAWAY' | 'USER_ERROR' | 'SIM_TIME_LIMIT';
export interface Fault { code: FaultCode; message: string; line?: number; blockId?: string; detail?: unknown }

export const FAULT_HELP: Record<FaultCode, string> = {
  UNREACHABLE: 'The target is outside the arm’s workspace, or no joint solution reaches it with that orientation.',
  JOINT_LIMIT: 'Reaching this target would push a joint past its mechanical limit.',
  SINGULARITY: 'A linear move passes through a singularity (e.g. the wrist aligns), causing a sudden joint flip. Try a joint move or a different path.',
  COLLISION: 'The arm or the part it holds would hit a fixture along this path.',
  INVALID_ARG: 'A command received an invalid argument, such as an unknown target name.',
  TIMEOUT: 'A wait for an input took longer than its timeout.',
  RUNAWAY: 'The program kept running without commanding the robot. Is there a loop with no motion or wait inside?',
  USER_ERROR: 'Your program threw an error.',
  SIM_TIME_LIMIT: 'The run exceeded the task’s simulated time limit.',
};

// ---------------- World state (pure data, structured-cloneable) ----------------
export interface ObjState {
  id: string; kind: string; shape: 'box' | 'cylinder'; size: V3; // size in meters
  pose: M4; // pose of bottom-center
  color: string; graspable: boolean;
  container?: { capacity: number; fill: number };
  toppled?: boolean;
  onConveyor?: string | null;
  spilled?: number;
}
export interface ActiveMotion {
  kind: 'path';
  times: number[]; // cumulative seconds
  qs: number[][];
  t: number;
}
export interface SimState {
  simTime: number;
  q: number[];
  gripperOpen: boolean;
  holding: null | { id: string; rel: M4 };
  objects: ObjState[];
  inputs: Record<string, boolean | string>;
  outputs: Record<string, boolean | string>;
  conveyors: Record<string, { nextSpawn: number; spawned: number }>;
  rng: number;
  spilled: number;
  faults: Fault[];
  active: null | {
    cmd: RobotCommand;
    motion?: ActiveMotion;
    until?: number;
    startTime: number;
    onDone?: { gripper?: 'open' | 'close' };
  };
  spawnCounter: number;
  targets: Record<string, Target>;
  totalLiquid: number;
}

export type StepResult = { status: 'idle' } | { status: 'running' } | { status: 'done'; value?: unknown } | { status: 'fault'; fault: Fault };

// ---------------- Predicates ----------------
export type PredicateDef =
  | { type: 'objectInRegion'; object: string; region: string; tolMm?: number; label?: string }
  | { type: 'countInRegion'; kind: string; region: string; count: number; color?: string; label?: string }
  | { type: 'sortedByColor'; kind: string; map: Record<string, string>; minCount?: number; label?: string }
  | { type: 'stackPattern'; region: string; kind: string; rows: number; cols: number; layers: number; tolMm?: number; label?: string }
  | { type: 'upright'; object: string; label?: string }
  | { type: 'fillAtLeast'; object: string; frac: number; label?: string }
  | { type: 'spilledAtMost'; frac: number; label?: string }
  | { type: 'noFaults'; label?: string }
  | { type: 'simTimeBelow'; sec: number; label?: string }
  | { type: 'programCompleted'; label?: string }
  | { type: 'targetTaught'; name: string; label?: string }
  | { type: 'holding'; object?: string; label?: string };
export interface PredicateResult { label: string; pass: boolean; detail?: string }

// ---------------- Agent view ----------------
export interface AgentStateView {
  simTimeSec: number;
  robot: { arm: string; jointsDeg: number[]; tcp: Pose; gripper: 'open' | 'closed'; holding: string | null };
  objects: { id: string; kind: string; color: string; position: [number, number, number]; upright: boolean; fill?: number }[];
  inputs: Record<string, boolean | string>;
  outputs: Record<string, boolean | string>;
  lastFault: Fault | null;
}
