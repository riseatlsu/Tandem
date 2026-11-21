/**
 * Compact, LLM-friendly representation of a block program ("steps"), converted to/from
 * Blockly's JSON serialization. The agent reads and proposes block programs in this form.
 */
export type Num = number | string; // number, variable name, or "i * 70 + 10"
export type Step =
  | { home: true; speed?: number }
  | { move: string; mode?: 'joint' | 'linear'; speed?: number }
  | { moveOffset: string; dx?: Num; dy?: Num; dz?: Num; mode?: 'joint' | 'linear'; speed?: number }
  | { gripper: 'open' | 'close' }
  | { waitInput: string; value: boolean | string | number; timeoutSec?: number }
  | { setOutput: string; value: boolean | string | number }
  | { wait: number }
  | { repeat: number; do: Step[] }
  | { forEach: string; from: number; to: number; do: Step[] }
  | { ifInput: string; value: boolean | string | number; do: Step[]; else?: Step[] }
  | { ifHolding: true; do: Step[]; else?: Step[] }
  | { log: string }
  | { note: string }
  | { raw: string }
  // multi-arm only (SPEC §21.7): cross-lane syncs, top level of a lane only
  | { sync: 'wait' }
  | { sync: 'move'; target: string; speed?: number }
  | { sync: 'follow' };
/** A multi-arm block program: one step list per robot id. */
export type Lanes = Record<string, Step[]>;

export const STEP_SCHEMA_DOC = `Block programs are written as a JSON array of steps (executed top to bottom):
  {"home": true, "speed"?: 1-100}
  {"move": "<target>", "mode"?: "joint"|"linear", "speed"?: 1-100}
  {"moveOffset": "<target>", "dx"?: N, "dy"?: N, "dz"?: N, "mode"?, "speed"?}   // N = number, variable, or "i * 70 + 10"
  {"gripper": "open"|"close"}
  {"waitInput": "<input>", "value": true|false|"text", "timeoutSec"?: number}
  {"setOutput": "<output>", "value": ...}
  {"wait": seconds}
  {"repeat": count, "do": [steps]}
  {"forEach": "<var>", "from": n, "to": n, "do": [steps]}   // inclusive counter loop
  {"ifInput": "<input>", "value": ..., "do": [steps], "else"?: [steps]}
  {"ifHolding": true, "do": [steps], "else"?: [steps]}
  {"log": "text"}
  {"note": "text"}`;

export const LANES_SCHEMA_DOC = `MULTI-ARM tasks: a program is {"lanes": {"A": [steps], "B": [steps]}}, one step list per arm (robot id).
Each arm uses ITS OWN target names (they are in that arm's base frame). Extra steps, top level only (never inside loops/ifs):
  {"sync": "wait"}                                   // "Wait for each other": every arm waits here until all arrive
  {"sync": "move", "target": "<target>", "speed"?: n} // "Move together": this arm leads a straight-line move...
  {"sync": "follow"}                                 // ...and every other arm has "follow" at the same position
The k-th sync step of every lane pairs with the k-th of every other lane: same count, same order. At each position all
arms have "wait", or exactly one has "move" and all others "follow".`;

type BJ = Record<string, unknown>;
let uid = 0;
const id = (p: string) => `${p}_${(++uid).toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

// ---------------- expressions
function tokenize(s: string): string[] {
  return s.match(/\d+(?:\.\d+)?|[A-Za-z_]\w*|[+\-*/()]/g) ?? [];
}
function exprToBlock(n: Num | undefined, vars: Map<string, string>): BJ {
  if (n === undefined) return { shadow: { type: 'math_number', fields: { NUM: 0 } } };
  if (typeof n === 'number') return { shadow: { type: 'math_number', fields: { NUM: n } } };
  const toks = tokenize(n);
  let i = 0;
  const varBlock = (name: string): BJ => {
    if (!vars.has(name)) vars.set(name, id('var'));
    return { type: 'variables_get', fields: { VAR: { id: vars.get(name) } } };
  };
  const factor = (): BJ => {
    const t = toks[i++];
    if (t === '(') { const e = sum(); i++; return e; }
    if (t === '-') { return { type: 'math_arithmetic', fields: { OP: 'MINUS' }, inputs: { A: { block: { type: 'math_number', fields: { NUM: 0 } } }, B: { block: factor() } } }; }
    if (t !== undefined && /^\d/.test(t)) return { type: 'math_number', fields: { NUM: Number(t) } };
    if (t !== undefined) return varBlock(t);
    return { type: 'math_number', fields: { NUM: 0 } };
  };
  const term = (): BJ => {
    let a = factor();
    while (toks[i] === '*' || toks[i] === '/') { const op = toks[i++] === '*' ? 'MULTIPLY' : 'DIVIDE'; a = { type: 'math_arithmetic', fields: { OP: op }, inputs: { A: { block: a }, B: { block: factor() } } }; }
    return a;
  };
  const sum = (): BJ => {
    let a = term();
    while (toks[i] === '+' || toks[i] === '-') { const op = toks[i++] === '+' ? 'ADD' : 'MINUS'; a = { type: 'math_arithmetic', fields: { OP: op }, inputs: { A: { block: a }, B: { block: term() } } }; }
    return a;
  };
  const b = sum();
  return { shadow: { type: 'math_number', fields: { NUM: 0 } }, block: b };
}

function blockToExpr(b: BJ | undefined, varNames: Map<string, string>): Num {
  if (!b) return 0;
  const type = b.type as string;
  const fields = (b.fields ?? {}) as BJ;
  const inputs = (b.inputs ?? {}) as Record<string, { block?: BJ; shadow?: BJ }>;
  if (type === 'math_number') return Number(fields.NUM);
  if (type === 'variables_get') return varNames.get((fields.VAR as { id: string }).id) ?? 'x';
  if (type === 'math_arithmetic') {
    const op = { ADD: '+', MINUS: '-', MULTIPLY: '*', DIVIDE: '/', POWER: '**' }[fields.OP as string] ?? '+';
    const A = inputs.A?.block ?? inputs.A?.shadow, B = inputs.B?.block ?? inputs.B?.shadow;
    return `(${blockToExpr(A, varNames)} ${op} ${blockToExpr(B, varNames)})`;
  }
  return 0;
}

const valStr = (v: boolean | string | number) => String(v);
const parseVal = (s: string): boolean | string | number => (s === 'true' ? true : s === 'false' ? false : s !== '' && !isNaN(Number(s)) ? Number(s) : s);

// ---------------- steps → Blockly JSON
function stepToBlock(s: Step, vars: Map<string, string>): BJ {
  const chain = (steps: Step[] | undefined) => (steps && steps.length ? { block: chainSteps(steps, vars) } : undefined);
  const mode = (m?: string) => (m === 'linear' ? 'L' : 'J');
  if ('home' in s) return { type: 'robot_home', id: id('b'), fields: { SPEED: s.speed ?? 50 } };
  if ('move' in s) return { type: 'robot_move', id: id('b'), fields: { TARGET: s.move, MODE: mode(s.mode), SPEED: s.speed ?? 50 } };
  if ('moveOffset' in s) return { type: 'robot_move_offset', id: id('b'), fields: { TARGET: s.moveOffset, MODE: mode(s.mode), SPEED: s.speed ?? 50 }, inputs: { DX: exprToBlock(s.dx, vars), DY: exprToBlock(s.dy, vars), DZ: exprToBlock(s.dz, vars) } };
  if ('gripper' in s) return { type: s.gripper === 'open' ? 'gripper_open' : 'gripper_close', id: id('b') };
  if ('waitInput' in s) return { type: 'io_wait_until', id: id('b'), fields: { INPUT: s.waitInput, VALUE: valStr(s.value), TIMEOUT: s.timeoutSec ?? 0 } };
  if ('setOutput' in s) return { type: 'io_set', id: id('b'), fields: { OUTPUT: s.setOutput, VALUE: valStr(s.value) } };
  if ('wait' in s) return { type: 'flow_wait', id: id('b'), fields: { SEC: s.wait } };
  if ('repeat' in s) return { type: 'controls_repeat_ext', id: id('b'), inputs: { TIMES: { shadow: { type: 'math_number', fields: { NUM: s.repeat } } }, DO: chain(s.do) } };
  if ('forEach' in s) {
    if (!vars.has(s.forEach)) vars.set(s.forEach, id('var'));
    return { type: 'controls_for', id: id('b'), fields: { VAR: { id: vars.get(s.forEach) } }, inputs: { FROM: { shadow: { type: 'math_number', fields: { NUM: s.from } } }, TO: { shadow: { type: 'math_number', fields: { NUM: s.to } } }, BY: { shadow: { type: 'math_number', fields: { NUM: 1 } } }, DO: chain(s.do) } };
  }
  if ('ifInput' in s) return { type: 'io_if', id: id('b'), fields: { INPUT: s.ifInput, VALUE: valStr(s.value) }, inputs: { DO: chain(s.do), ELSE: chain(s.else) } };
  if ('ifHolding' in s) return { type: 'gripper_if_holding', id: id('b'), inputs: { DO: chain(s.do), ELSE: chain(s.else) } };
  if ('log' in s) return { type: 'flow_log', id: id('b'), inputs: { MSG: { shadow: { type: 'text', fields: { TEXT: s.log } } } } };
  if ('note' in s) return { type: 'flow_note', id: id('b'), fields: { TEXT: s.note } };
  if ('sync' in s) {
    const ex = syncCtx.next();
    if (s.sync === 'wait') return { type: 'sync_wait', id: id('b'), extraState: { syncId: ex.syncId } };
    if (s.sync === 'move') return { type: 'sync_move', id: id('b'), fields: { TARGET: s.target, SPEED: s.speed ?? 30 }, extraState: { syncId: ex.syncId, role: 'lead', leader: syncCtx.lane } };
    return { type: 'sync_move', id: id('b'), extraState: { syncId: ex.syncId, role: 'follow', leader: ex.leader ?? '' } };
  }
  return { type: 'flow_note', id: id('b'), fields: { TEXT: `unsupported: ${JSON.stringify(s)}` } };
}
/** While building lanes: which lane is being built and how sync steps pair up across lanes. */
const syncCtx = {
  lane: '', k: 0, ids: [] as string[], leaders: [] as (string | undefined)[],
  next() { const k = this.k++; return { syncId: this.ids[k] ?? id('sync'), leader: this.leaders[k] }; },
};
/** Blockly's JSON loader chokes on `inputs: { DO: undefined }` (an empty loop/if body): drop empty inputs. */
function dropEmptyInputs(b: BJ): BJ {
  const inputs = b.inputs as Record<string, unknown> | undefined;
  if (inputs) for (const k of Object.keys(inputs)) if (inputs[k] === undefined) delete inputs[k];
  return b;
}
function chainSteps(steps: Step[], vars: Map<string, string>): BJ {
  const blocks = steps.map((s) => dropEmptyInputs(stepToBlock(s, vars)));
  for (let i = blocks.length - 2; i >= 0; i--) blocks[i].next = { block: blocks[i + 1] };
  return blocks[0];
}
export function stepsToWorkspaceJson(steps: Step[]): object {
  const vars = new Map<string, string>();
  const start: BJ = { type: 'program_start', id: 'start', x: 30, y: 30, deletable: false };
  if (steps.length) start.next = { block: chainSteps(steps, vars) };
  return {
    blocks: { languageVersion: 0, blocks: [start] },
    variables: [...vars.entries()].map(([name, vid]) => ({ name, id: vid })),
  };
}

/** Horizontal distance between lane hats (px, workspace units); the editor re-spaces lanes to fit their blocks. */
export const LANE_SPACING = 380;
/** Lanes → one Blockly workspace with a "lane_start" hat per arm, side by side (SPEC §21.5). */
export function lanesToWorkspaceJson(lanes: Lanes, labels: Record<string, string>, order = Object.keys(lanes)): object {
  const vars = new Map<string, string>();
  // pair the k-th sync of every lane: one shared id, and the leader of each "move together"
  const n = Math.max(0, ...order.map((r) => (lanes[r] ?? []).filter((x) => 'sync' in x).length));
  const ids = Array.from({ length: n }, () => id('sync'));
  const leaders = ids.map((_, k) => order.find((r) => { const st = (lanes[r] ?? []).filter((x) => 'sync' in x)[k]; return st && 'sync' in st && st.sync === 'move'; }));
  const blocks = order.map((robot, i) => {
    Object.assign(syncCtx, { lane: robot, k: 0, ids, leaders });
    const start: BJ = { type: 'lane_start', id: `start_${robot}`, x: 30 + i * LANE_SPACING, y: 30, deletable: false, movable: false, extraState: { robot, label: labels[robot] ?? robot } };
    const steps = lanes[robot] ?? [];
    if (steps.length) start.next = { block: chainSteps(steps, vars) };
    return start;
  });
  return { blocks: { languageVersion: 0, blocks }, variables: [...vars.entries()].map(([name, vid]) => ({ name, id: vid })) };
}

// ---------------- Blockly JSON → steps
function walker(varNames: Map<string, string>) {
  const walk = (b: BJ | undefined): Step[] => {
    const out: Step[] = [];
    let cur = b;
    while (cur) {
      if (cur.enabled !== false) out.push(blockToStep(cur));
      cur = (cur.next as { block?: BJ } | undefined)?.block;
    }
    return out;
  };
  const blockToStep = (b: BJ): Step => {
    const f = (b.fields ?? {}) as Record<string, unknown>;
    const inp = (b.inputs ?? {}) as Record<string, { block?: BJ; shadow?: BJ }>;
    const mode = f.MODE === 'L' ? 'linear' : 'joint';
    const sub = (n: string) => walk(inp[n]?.block);
    switch (b.type) {
      case 'robot_home': return { home: true, speed: Number(f.SPEED) };
      case 'robot_move': return { move: String(f.TARGET), mode, speed: Number(f.SPEED) };
      case 'robot_move_offset': return { moveOffset: String(f.TARGET), dx: blockToExpr(inp.DX?.block ?? inp.DX?.shadow, varNames), dy: blockToExpr(inp.DY?.block ?? inp.DY?.shadow, varNames), dz: blockToExpr(inp.DZ?.block ?? inp.DZ?.shadow, varNames), mode, speed: Number(f.SPEED) };
      case 'gripper_open': return { gripper: 'open' };
      case 'gripper_close': return { gripper: 'close' };
      case 'io_wait_until': return { waitInput: String(f.INPUT), value: parseVal(String(f.VALUE)), ...(Number(f.TIMEOUT) > 0 ? { timeoutSec: Number(f.TIMEOUT) } : {}) };
      case 'io_set': return { setOutput: String(f.OUTPUT), value: parseVal(String(f.VALUE)) };
      case 'flow_wait': return { wait: Number(f.SEC) };
      case 'controls_repeat_ext': return { repeat: Number(blockToExpr(inp.TIMES?.block ?? inp.TIMES?.shadow, varNames)), do: sub('DO') };
      case 'controls_for': return { forEach: varNames.get((f.VAR as { id: string })?.id) ?? 'i', from: Number(blockToExpr(inp.FROM?.block ?? inp.FROM?.shadow, varNames)), to: Number(blockToExpr(inp.TO?.block ?? inp.TO?.shadow, varNames)), do: sub('DO') };
      case 'io_if': return { ifInput: String(f.INPUT), value: parseVal(String(f.VALUE)), do: sub('DO'), else: sub('ELSE') };
      case 'gripper_if_holding': return { ifHolding: true, do: sub('DO'), else: sub('ELSE') };
      case 'flow_log': { const m = inp.MSG?.block ?? inp.MSG?.shadow; return { log: String(((m?.fields ?? {}) as BJ).TEXT ?? '') }; }
      case 'flow_note': return { note: String(f.TEXT) };
      case 'sync_wait': return { sync: 'wait' };
      case 'sync_move': {
        const ex = (b.extraState ?? {}) as { role?: string };
        return ex.role === 'follow' ? { sync: 'follow' } : { sync: 'move', target: String(f.TARGET ?? ''), speed: Number(f.SPEED ?? 30) };
      }
      default: return { raw: String(b.type) };
    }
  };
  return walk;
}
type WsJson = { blocks?: { blocks?: BJ[] }; variables?: { name: string; id: string }[] };
export function workspaceJsonToSteps(json: unknown): Step[] {
  const j = json as WsJson;
  const varNames = new Map((j?.variables ?? []).map((v) => [v.id, v.name]));
  const start = (j?.blocks?.blocks ?? []).find((b) => b.type === 'program_start');
  if (!start) return [];
  return walker(varNames)((start.next as { block?: BJ } | undefined)?.block);
}
/** Multi-arm workspace → steps per robot id (lanes without a hat are omitted). */
export function workspaceJsonToLanes(json: unknown): Lanes {
  const j = json as WsJson;
  const varNames = new Map((j?.variables ?? []).map((v) => [v.id, v.name]));
  const walk = walker(varNames);
  const out: Lanes = {};
  for (const b of j?.blocks?.blocks ?? []) {
    if (b.type !== 'lane_start') continue;
    const robot = ((b.extraState ?? {}) as { robot?: string }).robot;
    if (robot) out[robot] = walk((b.next as { block?: BJ } | undefined)?.block);
  }
  return out;
}

// ---------------- validation
export interface StepEnv { targets: string[]; inputs: string[]; outputs: string[]; /** set when validating a lane of a multi-arm program */ lanes?: boolean }
export function validateSteps(steps: unknown, env: StepEnv, path = 'steps'): string[] {
  const errs: string[] = [];
  if (!Array.isArray(steps)) return [`${path} must be an array`];
  steps.forEach((s, i) => {
    const p = `${path}[${i}]`;
    if (!s || typeof s !== 'object') { errs.push(`${p} must be an object`); return; }
    const o = s as Record<string, unknown>;
    const has = (k: string) => k in o;
    const speedOk = () => { if (has('speed') && !(typeof o.speed === 'number' && o.speed >= 1 && o.speed <= 100)) errs.push(`${p}.speed must be 1–100`); };
    const tgt = (k: string) => { if (typeof o[k] !== 'string') errs.push(`${p}.${k} must be a target name`); else if (!env.targets.includes(o[k] as string)) errs.push(`${p}: unknown target "${o[k]}" (known: ${env.targets.join(', ')})`); };
    if (has('home')) speedOk();
    else if (has('move')) { tgt('move'); speedOk(); }
    else if (has('moveOffset')) { tgt('moveOffset'); speedOk(); for (const k of ['dx', 'dy', 'dz']) if (has(k) && !['number', 'string'].includes(typeof o[k])) errs.push(`${p}.${k} must be a number or expression`); }
    else if (has('gripper')) { if (o.gripper !== 'open' && o.gripper !== 'close') errs.push(`${p}.gripper must be "open" or "close"`); }
    else if (has('waitInput')) { if (!env.inputs.includes(o.waitInput as string)) errs.push(`${p}: unknown input "${o.waitInput}" (known: ${env.inputs.join(', ') || 'none'})`); }
    else if (has('setOutput')) { if (!env.outputs.includes(o.setOutput as string)) errs.push(`${p}: unknown output "${o.setOutput}"`); }
    else if (has('wait')) { if (typeof o.wait !== 'number') errs.push(`${p}.wait must be seconds`); }
    else if (has('repeat')) { if (typeof o.repeat !== 'number') errs.push(`${p}.repeat must be a number`); errs.push(...validateSteps(o.do, env, `${p}.do`)); }
    else if (has('forEach')) { if (typeof o.forEach !== 'string') errs.push(`${p}.forEach must be a variable name`); errs.push(...validateSteps(o.do, env, `${p}.do`)); }
    else if (has('ifInput')) { if (!env.inputs.includes(o.ifInput as string)) errs.push(`${p}: unknown input "${o.ifInput}"`); errs.push(...validateSteps(o.do, env, `${p}.do`)); if (has('else')) errs.push(...validateSteps(o.else, env, `${p}.else`)); }
    else if (has('ifHolding')) { errs.push(...validateSteps(o.do, env, `${p}.do`)); if (has('else')) errs.push(...validateSteps(o.else, env, `${p}.else`)); }
    else if (has('log') || has('note')) { /* ok */ }
    else if (has('sync')) {
      if (!env.lanes) errs.push(`${p}: sync steps only exist in multi-arm tasks`);
      else if (/\.(do|else)\b/.test(path)) errs.push(`${p}: sync steps must be at the top level of a lane, not inside a loop or if`);
      if (o.sync === 'move') { tgt('target'); speedOk(); }
      else if (o.sync !== 'wait' && o.sync !== 'follow') errs.push(`${p}.sync must be "wait", "move" or "follow"`);
    }
    else errs.push(`${p}: unknown step ${JSON.stringify(o).slice(0, 80)}`);
  });
  return errs;
}

/** Validate a multi-arm program: every lane against its own arm's targets, then that the sync steps pair up. */
export function validateLanes(lanes: unknown, envFor: (robot: string) => StepEnv | null, robots: string[]): string[] {
  if (!lanes || typeof lanes !== 'object' || Array.isArray(lanes)) return ['lanes must be an object {"A": [steps], "B": [steps]}'];
  const errs: string[] = [];
  const L = lanes as Record<string, unknown>;
  for (const r of Object.keys(L)) if (!robots.includes(r)) errs.push(`unknown arm "${r}" (arms: ${robots.join(', ')})`);
  for (const r of robots) {
    if (!(r in L)) { errs.push(`lanes.${r} is missing (every arm needs a lane, even an empty one)`); continue; }
    const env = envFor(r);
    if (env) errs.push(...validateSteps(L[r], { ...env, lanes: true }, `lanes.${r}`));
  }
  if (errs.length) return errs;
  const kinds = robots.map((r) => (L[r] as Step[]).filter((x) => 'sync' in x).map((x) => (x as { sync: string }).sync));
  const n = Math.max(...kinds.map((k) => k.length));
  if (kinds.some((k) => k.length !== n)) errs.push(`every lane needs the same number of sync steps (${robots.map((r, i) => `${r}: ${kinds[i].length}`).join(', ')})`);
  else for (let k = 0; k < n; k++) {
    const at = kinds.map((x) => x[k]);
    const ok = at.every((x) => x === 'wait') || (at.filter((x) => x === 'move').length === 1 && at.every((x) => x === 'move' || x === 'follow'));
    if (!ok) errs.push(`sync #${k + 1} doesn't match (${robots.map((r, i) => `${r}: ${at[i]}`).join(', ')}): all "wait", or one "move" and the rest "follow"`);
  }
  return errs;
}

/** Steps → JS using the same semantics as the block generator (used for agent dry runs). */
export function stepsToJs(steps: Step[], indent = ''): string {
  const lit = (v: unknown) => JSON.stringify(v);
  const num = (n: Num | undefined) => (n === undefined ? '0' : String(n));
  const L = (s: string) => `${indent}${s}\n`;
  let out = '';
  for (const s of steps) {
    if ('home' in s) out += L(`await robot.home({ speed: ${s.speed ?? 50} });`);
    else if ('move' in s) out += L(`await robot.move${s.mode === 'linear' ? 'L' : 'J'}(${lit(s.move)}, { speed: ${s.speed ?? 50} });`);
    else if ('moveOffset' in s) out += L(`await robot.move${s.mode === 'linear' ? 'L' : 'J'}(offset(${lit(s.moveOffset)}, ${num(s.dx)}, ${num(s.dy)}, ${num(s.dz)}), { speed: ${s.speed ?? 50} });`);
    else if ('gripper' in s) out += L(`await gripper.${s.gripper}();`);
    else if ('waitInput' in s) out += L(`await io.waitFor(${lit(s.waitInput)}, ${lit(s.value)}${s.timeoutSec ? `, ${s.timeoutSec * 1000}` : ''});`);
    else if ('setOutput' in s) out += L(`await io.set(${lit(s.setOutput)}, ${lit(s.value)});`);
    else if ('wait' in s) out += L(`await robot.wait(${Math.round(s.wait * 1000)});`);
    else if ('repeat' in s) out += L(`for (let _r = 0; _r < ${s.repeat}; _r++) {`) + stepsToJs(s.do, indent + '  ') + L('}');
    else if ('forEach' in s) out += L(`for (let ${s.forEach} = ${s.from}; ${s.forEach} <= ${s.to}; ${s.forEach}++) {`) + stepsToJs(s.do, indent + '  ') + L('}');
    else if ('ifInput' in s) out += L(`if ((await io.get(${lit(s.ifInput)})) === ${lit(s.value)}) {`) + stepsToJs(s.do, indent + '  ') + L('} else {') + stepsToJs(s.else ?? [], indent + '  ') + L('}');
    else if ('ifHolding' in s) out += L(`if (await gripper.holding()) {`) + stepsToJs(s.do, indent + '  ') + L('} else {') + stepsToJs(s.else ?? [], indent + '  ') + L('}');
    else if ('log' in s) out += L(`log(${lit(s.log)});`);
    else if ('note' in s) out += L(`// ${s.note}`);
    else if ('sync' in s) out += L(s.sync === 'wait' ? 'await sync();' : s.sync === 'move' ? `await robot.moveTogether(${lit(s.target)}, { speed: ${s.speed ?? 30} });` : 'await robot.follow();');
  }
  return out;
}
export const lanesToJs = (lanes: Lanes): Record<string, string> => Object.fromEntries(Object.entries(lanes).map(([r, st]) => [r, stepsToJs(st)]));

/** Starter blocks from task JSON ([{type:'robot_home'}, ...]) */
export function starterToSteps(starter: { type: string }[] | undefined): Step[] {
  return (starter ?? []).map((b) => (b.type === 'robot_home' ? { home: true as const } : b.type === 'gripper_open' ? { gripper: 'open' as const } : { note: b.type }));
}
