import type { M4, V3 } from './math/mat4';

/** User-facing pose: mm and degrees, R = Rx(rx)·Ry(ry)·Rz(rz), in the robot base (= world) frame. */
export interface Pose { x: number; y: number; z: number; rx: number; ry: number; rz: number }

// ---------------- 3D models ----------------
/**
 * A model file under public/models (.glb/.gltf/.obj/.stl/.dae). Purely visual: collision and grasping
 * always use the owner's box/cylinder/capsule shapes, so the simulation stays deterministic.
 */
export interface MeshRef {
  file: string; // path relative to public/, e.g. "models/my-lab/cnc.glb"
  units?: 'm' | 'cm' | 'mm' | 'in'; // units the file was modelled in (default m for glb/gltf/dae, mm for obj/stl)
  scale?: number; // extra uniform scale
  upAxis?: 'z' | 'y'; // glTF and most DCC tools are Y-up (default y for glb/gltf, z otherwise)
  offset?: [number, number, number]; // mm, applied after centering
  rotation?: [number, number, number]; // deg, XYZ
  color?: string; // override material color (files without materials get a glossy default)
}
/** Arm part: a mesh attached to one link. `frame: 'zero'` = modelled in place with the arm at all-zero joints. */
export type ArmMeshPart = MeshRef & { link: number | string; frame?: 'link' | 'zero' };

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
  kind: 'articulated6' | 'scara4' | 'other';
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
    | { source: 'procedural'; color: string; accent: string }
    /** Your own models: one file per link (`parts`), and/or one file whose named nodes map to links (`model.nodes`). */
    | { source: 'mesh'; parts?: ArmMeshPart[]; model?: MeshRef & { nodes: Record<string, number | string>; frame?: 'link' | 'zero' } };
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
  kind: 'box' | 'bin' | 'conveyor' | 'rack' | 'region' | 'model';
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
  /** kind 'model': a 3D model drawn centered in the fixture's box (the box is what the robot collides with) */
  mesh?: MeshRef;
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
  /** drawn instead of the box/cylinder; its bottom sits on the object's position */
  mesh?: MeshRef;
  /** Too wide/heavy for one gripper: it only lifts in a synced move where every arm holding it takes part (SPEC §21.3). */
  twoHanded?: boolean;
}
/** Planar mount of one arm in a multi-arm cell: position in mm, yaw (rz) in degrees about world Z. */
export interface RobotBase { x: number; y: number; z: number; rz: number }
/** One arm of a multi-arm scene (SPEC §21.2). Its targets are in its own base frame. */
export interface SceneRobotDef { id: string; label: string; armId: string; base: RobotBase; color?: string; targets?: Record<string, Pose> }
export interface RegionDef { id: string; center: [number, number, number]; size: [number, number, number]; label?: string }
export interface ConveyorDef {
  id: string;
  start: [number, number, number]; // spawn point (mm, belt top surface)
  end: [number, number, number]; // sensor/stop point
  speed: number; // mm/s
  runOutput: string; // output name that runs the belt
  sensorInput: string; // input set true when a part waits at the end
  colorInput?: string; // optional input reporting the color at the sensor
  spawn: { intervalSec: number; jitterSec: number; count: number; colors: string[]; cycle?: boolean; size: [number, number, number]; kind: string; shape?: 'box' | 'cylinder'; prefill?: boolean; mesh?: MeshRef };
}
export interface SceneDef {
  id: string;
  title: string;
  environment: 'factory' | 'warehouse' | 'kitchen' | 'lab' | 'custom';
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
  /** Multi-arm cells: one entry per arm (ids A, B, …). Absent = single-arm scene using the task's arm and `sceneTargets`. */
  robots?: SceneRobotDef[];
}

// ---------------- Targets ----------------
export interface Target { name: string; pose: Pose; q?: number[]; source: 'taught' | 'scene' | 'preset' }
export type TargetRef = string | Pose;

// ---------------- Commands & faults ----------------
type RobotCommandBody =
  | { op: 'moveJ' | 'moveL'; target: TargetRef; speed?: number }
  | { op: 'moveJoints'; jointsDeg: number[]; speed?: number }
  | { op: 'home'; speed?: number }
  | { op: 'gripper'; action: 'open' | 'close' }
  | { op: 'wait'; ms: number }
  | { op: 'waitInput'; name: string; value: boolean | string; timeoutMs?: number }
  | { op: 'setOutput'; name: string; value: boolean | string }
  | { op: 'query'; what: 'pose' | 'joints' | 'input' | 'holding'; name?: string }
  /** Cross-lane sync (SPEC §21.3). Coordinated by the run scheduler, never passed to SimCore.begin. */
  | { op: 'sync'; kind: 'wait' | 'follow' }
  | { op: 'sync'; kind: 'move'; target: TargetRef; speed?: number };
/** A command for one robot; `robot` defaults to the cell's first robot. */
export type RobotCommand = RobotCommandBody & { robot?: string };

export type FaultCode =
  | 'UNREACHABLE' | 'JOINT_LIMIT' | 'SINGULARITY' | 'COLLISION' | 'INVALID_ARG'
  | 'TIMEOUT' | 'RUNAWAY' | 'USER_ERROR' | 'SIM_TIME_LIMIT'
  | 'ARM_COLLISION' | 'SHARED_GRASP' | 'NEEDS_TWO_HANDS' | 'SYNC_MISMATCH';
/** `robot` names the arm (lane) the fault belongs to in multi-arm cells. */
export interface Fault { code: FaultCode; message: string; line?: number; blockId?: string; robot?: string; detail?: unknown }

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
  ARM_COLLISION: 'Two arms would hit each other. Add a “Wait for each other” so one arm moves out of the way first, or change a position.',
  SHARED_GRASP: 'More than one arm is holding this part, so one arm can’t move it alone. Open one gripper, or use “Move together”.',
  NEEDS_TWO_HANDS: 'This part is too wide for one gripper. Grip it with both arms, then lift it with “Move together”.',
  SYNC_MISMATCH: 'The arms’ programs don’t have matching sync blocks, so one arm would wait forever. Every program needs the same “Wait for each other” and “Move together” blocks, in the same order.',
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
  twoHanded?: boolean;
  /** Mid-air transfers: `to` grasped the part while `from` was holding it. */
  handovers?: { from: string; to: string }[];
}
export interface ActiveCommand {
  cmd: RobotCommand;
  /** true while a planned path is being followed */
  motion?: boolean;
  until?: number;
  startTime: number;
  onDone?: { gripper?: 'open' | 'close' };
}
/** Per-arm state. Joints, TCP and targets are in the arm's own base frame. */
export interface RobotState {
  q: number[];
  gripperOpen: boolean;
  /** rel = held object's pose relative to this arm's TCP */
  holding: null | { id: string; rel: M4 };
  active: null | ActiveCommand;
  targets: Record<string, Target>;
}
export interface SimState {
  simTime: number;
  robots: Record<string, RobotState>;
  objects: ObjState[];
  inputs: Record<string, boolean | string>;
  outputs: Record<string, boolean | string>;
  conveyors: Record<string, { nextSpawn: number; spawned: number }>;
  rng: number;
  spilled: number;
  faults: Fault[];
  spawnCounter: number;
  totalLiquid: number;
}

export type StepResult = { status: 'idle' } | { status: 'running' } | { status: 'done'; value?: unknown } | { status: 'fault'; fault: Fault };
/** A robot's command finished (or faulted) during SimCore.stepAll. */
export type RobotEvent = { robot: string; status: 'done'; value?: unknown } | { robot: string; status: 'fault'; fault: Fault };

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
  | { type: 'targetTaught'; name: string; robot?: string; label?: string }
  | { type: 'holding'; object?: string; robot?: string; label?: string }
  | { type: 'objectOn'; object: string; on: string; tolMm?: number; label?: string }
  | { type: 'handedOver'; object: string; from: string; to: string; label?: string }
  | { type: 'noArmCollisions'; label?: string };
export interface PredicateResult { label: string; pass: boolean; detail?: string }

// ---------------- Agent view ----------------
export interface AgentRobotView { arm: string; jointsDeg: number[]; tcp: Pose; gripper: 'open' | 'closed'; holding: string | null }
export interface AgentStateView {
  simTimeSec: number;
  robot: AgentRobotView;
  /** Multi-arm cells only: every arm, first one = `robot`. */
  robots?: (AgentRobotView & { id: string; label: string })[];
  objects: { id: string; kind: string; color: string; position: [number, number, number]; upright: boolean; fill?: number }[];
  inputs: Record<string, boolean | string>;
  outputs: Record<string, boolean | string>;
  lastFault: Fault | null;
}
