// Exposed to Monaco as an extra lib. Keep in sync with src/runtime/robotApi.ts and content/docs/api-reference.md.
export const ROBOT_API_DTS = `
/** A pose in the robot base frame. Millimeters and degrees; R = Rx(rx)·Ry(ry)·Rz(rz). */
interface Pose { x: number; y: number; z: number; rx: number; ry: number; rz: number }
/** A taught/cell target name, or a pose. */
type TargetLike = string | Pose;
interface MoveOpts {
  /** Percent of the arm's maximum speed, 1–100 (default 50). */
  speed?: number;
}
declare const robot: {
  /** Joint move: every joint moves at once along the fastest path. Uses the taught arm configuration for taught targets. */
  moveJ(target: TargetLike, opts?: MoveOpts): Promise<void>;
  /** Linear move: the tool travels in a straight line. Use for approach/retreat. Can fault near singularities. */
  moveL(target: TargetLike, opts?: MoveOpts): Promise<void>;
  /** Move to explicit joint angles (degrees; millimeters for prismatic joints). */
  moveJoints(jointsDeg: number[], opts?: MoveOpts): Promise<void>;
  /** Joint move to the arm's home configuration. */
  home(opts?: MoveOpts): Promise<void>;
  /** Current tool pose. */
  getPose(): Promise<Pose>;
  /** Current joint angles in degrees. */
  getJoints(): Promise<number[]>;
  /** Wait a number of milliseconds (simulated time). */
  wait(ms: number): Promise<void>;
  /** Multi-arm: lead a move together. This arm moves in a straight line; every other arm calls robot.follow() at the same point and keeps its distance. */
  moveTogether(target: TargetLike, opts?: MoveOpts): Promise<void>;
  /** Multi-arm: follow the arm that calls robot.moveTogether() at this point, keeping the same distance to it. */
  follow(): Promise<void>;
};
declare const gripper: {
  open(): Promise<void>;
  /** Close the fingers; a part between them is picked up. */
  close(): Promise<void>;
  /** Id of the held part, or null. */
  holding(): Promise<string | null>;
};
declare const io: {
  /** Read a digital/text input, e.g. 'part_present' or 'part_color'. */
  get(name: string): Promise<boolean | string>;
  /** Set an output, e.g. 'conveyor_run'. */
  set(name: string, value: boolean | string): Promise<void>;
  /** Wait until an input equals a value. Throws TIMEOUT after timeoutMs (if given). */
  waitFor(name: string, value: boolean | string, timeoutMs?: number): Promise<void>;
};
declare const targets: {
  /** A copy of a target's pose. */
  get(name: string): Pose;
  /** Names of all targets (taught + cell). */
  list(): string[];
};
/** A pose shifted by dx, dy, dz millimeters in the base frame. */
declare function offset(p: TargetLike, dx: number, dy: number, dz: number): Pose;
/** Print to the console panel. */
declare function log(...args: unknown[]): void;
/** Multi-arm: wait for each other. Resolves once every arm's program reaches its matching sync(). */
declare function sync(): Promise<void>;
`;
