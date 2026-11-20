/**
 * The user-facing robot API (see robot-api.d.ts). Shared by the program worker (RPC)
 * and the headless dry-run executor (direct calls).
 */
import type { Fault, Pose } from '../sim/types';
import type { WireCommand } from './protocol';

export class RobotFault extends Error {
  constructor(public fault: Fault) { super(fault.message); this.name = 'RobotFault'; }
}

export type CallFn = (cmd: WireCommand, line?: number) => Promise<unknown>;

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (...args: string[]) => (...a: unknown[]) => Promise<void>;
export const SOURCE_URL = 'user-program.js';
const PARAMS = ['robot', 'gripper', 'io', 'targets', 'offset', 'log', '__hl'];

let lineOffset: number | null = null;
function parseLine(stack: string | undefined): number | undefined {
  if (!stack) return undefined;
  const m = stack.match(/user-program\.js:(\d+)(?::\d+)?/);
  return m ? Number(m[1]) : undefined;
}
/** `new Function` bodies get engine-specific header lines; measure once with the same parameter list. */
function getOffset(): number {
  if (lineOffset !== null) return lineOffset;
  try {
    new Function(...PARAMS, `throw new Error('probe');\n//# sourceURL=${SOURCE_URL}`)();
    lineOffset = 0;
  } catch (e) {
    const l = parseLine((e as Error).stack);
    lineOffset = l !== undefined ? l - 1 : 0;
  }
  return lineOffset;
}
export function userLine(stack?: string): number | undefined {
  const l = parseLine(stack ?? new Error().stack);
  return l === undefined ? undefined : Math.max(1, l - getOffset());
}

export function compileProgram(src: string) {
  getOffset();
  return new AsyncFunction(...PARAMS, `${src}\n//# sourceURL=${SOURCE_URL}`);
}

function checkPoseLike(p: unknown, fn: string) {
  if (typeof p === 'string') return;
  const o = p as Record<string, unknown>;
  if (!o || typeof o !== 'object' || ['x', 'y', 'z', 'rx', 'ry', 'rz'].some((k) => typeof o[k] !== 'number'))
    throw new RobotFault({ code: 'INVALID_ARG', message: `${fn}() needs a target name or a pose {x, y, z, rx, ry, rz}.` });
}

export function createApi(call: CallFn, targetMap: Record<string, Pose>, log: (args: unknown[], line?: number) => void) {
  const here = () => userLine(new Error().stack);
  const c = (cmd: WireCommand) => call(cmd, here());
  const resolve = (p: string | Pose, fn: string): Pose => {
    if (typeof p === 'string') {
      const t = targetMap[p];
      if (!t) throw new RobotFault({ code: 'INVALID_ARG', message: `${fn}(): unknown target “${p}”.` });
      return { ...t };
    }
    checkPoseLike(p, fn);
    return { ...p };
  };
  const robot = Object.freeze({
    moveJ: (target: string | Pose, opts?: { speed?: number }) => { checkPoseLike(target, 'moveJ'); return c({ op: 'moveJ', target, speed: opts?.speed }) as Promise<void>; },
    moveL: (target: string | Pose, opts?: { speed?: number }) => { checkPoseLike(target, 'moveL'); return c({ op: 'moveL', target, speed: opts?.speed }) as Promise<void>; },
    moveJoints: (jointsDeg: number[], opts?: { speed?: number }) => c({ op: 'moveJoints', jointsDeg, speed: opts?.speed }) as Promise<void>,
    home: (opts?: { speed?: number }) => c({ op: 'home', speed: opts?.speed }) as Promise<void>,
    getPose: () => c({ op: 'query', what: 'pose' }) as Promise<Pose>,
    getJoints: () => c({ op: 'query', what: 'joints' }) as Promise<number[]>,
    wait: (ms: number) => c({ op: 'wait', ms }) as Promise<void>,
  });
  const gripper = Object.freeze({
    open: () => c({ op: 'gripper', action: 'open' }) as Promise<void>,
    close: () => c({ op: 'gripper', action: 'close' }) as Promise<void>,
    holding: () => c({ op: 'query', what: 'holding' }) as Promise<string | null>,
  });
  const io = Object.freeze({
    get: (name: string) => c({ op: 'query', what: 'input', name }) as Promise<boolean | string>,
    set: (name: string, value: boolean | string) => c({ op: 'setOutput', name, value }) as Promise<void>,
    waitFor: (name: string, value: boolean | string, timeoutMs?: number) => c({ op: 'waitInput', name, value, timeoutMs }) as Promise<void>,
  });
  const targets = Object.freeze({
    get: (name: string) => resolve(name, 'targets.get'),
    list: () => Object.keys(targetMap),
  });
  const offset = (p: string | Pose, dx = 0, dy = 0, dz = 0): Pose => {
    const b = resolve(p, 'offset');
    if ([dx, dy, dz].some((v) => typeof v !== 'number' || !isFinite(v))) throw new RobotFault({ code: 'INVALID_ARG', message: 'offset() needs numeric dx, dy, dz (mm).' });
    return { ...b, x: b.x + dx, y: b.y + dy, z: b.z + dz };
  };
  const logFn = (...args: unknown[]) => log(args, here());
  const hl = (blockId: string) => call({ op: 'hl', blockId });
  return { robot, gripper, io, targets, offset, log: logFn, __hl: hl };
}

export function formatLogArg(a: unknown): string {
  if (typeof a === 'string') return a;
  try { return JSON.stringify(a); } catch { return String(a); }
}
