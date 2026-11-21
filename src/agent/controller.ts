import { HumanMessage, type BaseMessage, type AIMessage } from '@langchain/core/messages';
import { useApp, ALL_FEATURES, NO_FEATURES, type AgentFeatures, type ChatMsg, type PlanCheck, type Proposal, updateWorkspace, currentWorkspace, laneTargets } from '../store';
import { clipById } from './clips';
import { planSummary } from './plans';
import { playGhost } from '../view/ghost';
import { host } from '../simHost';
import { ARMS, TASKS, robotsFor, sceneForTask } from '../content';
import { SimCore } from '../sim/SimCore';
import { dryRun } from '../runtime/dryRun';
import { programSource } from '../editor/program';
import { lanesToJs, lanesToWorkspaceJson, stepsToJs, stepsToWorkspaceJson, validateLanes, validateSteps, workspaceJsonToLanes, workspaceJsonToSteps, type Lanes, type Step } from '../blocks/steps';
import { splitLanes, type ProgramSource } from '../runtime/headless';
import { searchDocs } from './docsSearch';
import { makeTools, type AgentBridge } from './tools';
import { isReasoningModel, makeModel, REASONING_EFFORT } from './llm';
import { runAgentTurn } from './graph';
import { runJsonProtocolTurn } from './jsonProtocol';
import { PROMPT_VERSION, systemPrompt } from './prompts/system.v4';
import { getIdToken } from '../firebase';
import { logEvent } from '../study/logger';
import { CONFIG } from '../config';
import type { RunTrace } from '../runtime/protocol';

const histories: Record<string, BaseMessage[]> = {};
const noToolModels = new Set<string>();
let abort: AbortController | null = null;
let msgId = 0;
const nid = () => `m${Date.now().toString(36)}${(++msgId).toString(36)}`;

export const agentMode = () => { const s = useApp.getState(); return s.mode === 'study' ? s.study?.agentMode ?? 'off' : 'suggest'; };
export const activeModel = () => { const s = useApp.getState(); return s.mode === 'study' ? s.study?.model ?? 'gpt-5-mini' : s.demoModel; };
export const agentFeatures = (): AgentFeatures => { const s = useApp.getState(); return s.mode === 'study' ? s.study?.features ?? NO_FEATURES : ALL_FEATURES; };
export const agentConfigured = () => !!CONFIG.llmProxyUrl;

function pushMsg(m: ChatMsg) {
  useApp.getState().set((s) => ({ chats: { ...s.chats, [s.taskId]: [...(s.chats[s.taskId] ?? []), m] } }));
}
/** Visuals/plans made by a tool are shown after that tool's status pill (flushed in onToolEnd). */
let pendingVisuals: ChatMsg[] = [];
function pushVisual(m: ChatMsg) { pendingVisuals.push(m); }
function flushVisuals() { const q = pendingVisuals; pendingVisuals = []; q.forEach(pushMsg); }
function patchMsg(id: string, p: Partial<ChatMsg> | ((m: ChatMsg) => Partial<ChatMsg>)) {
  useApp.getState().set((s) => ({ chats: { ...s.chats, [s.taskId]: (s.chats[s.taskId] ?? []).map((m) => (m.id === id ? { ...m, ...(typeof p === 'function' ? p(m) : p) } : m)) } }));
}

function summarizeTrace(t: RunTrace | null, maxEntries = 40) {
  if (!t) return null;
  return {
    outcome: t.outcome, fault: t.fault, simDurationSec: t.simDurationSec,
    goals: t.predicates.map((p) => ({ goal: p.label, pass: p.pass, detail: p.detail })),
    commands: t.entries.slice(-maxEntries).map((e) => ({ t: +e.simTime.toFixed(2), ...(e.robot ? { arm: e.robot } : {}), line: e.line, block: e.blockId, cmd: e.cmd, result: e.result === 'ok' ? 'ok' : `${e.result.code}: ${e.result.message}` })),
    logs: t.logs.slice(-15).map((l) => l.text),
  };
}

/** Targets/signals a step list may use; `robot` selects an arm's targets in multi-arm tasks. */
function stepEnv(robot?: string) {
  const sim = host.sim;
  const r = robot ?? sim.primary;
  return { targets: Object.keys({ ...sim.allTargets(r), ...laneTargets(currentWorkspace(), r) }), inputs: sim.scene.io.inputs.map((i) => i.name), outputs: sim.scene.io.outputs.map((o) => o.name) };
}
const multi = () => host.sim.multi;
const laneLabels = () => Object.fromEntries(host.sim.robotIds.map((r) => [r, host.sim.label(r)]));
const usageHint = (editor: string) => (multi()
  ? editor === 'blocks' ? 'This is a multi-arm task in blocks mode: pass {"lanes": {"A": [steps], "B": [steps]}}.' : 'This is a multi-arm task in code mode: pass {"programs": {"A": "...", "B": "..."}}.'
  : editor === 'blocks' ? 'Pass {"steps": [...]}' : 'Pass {"program": "..."}');
interface ProgramInput { program?: string; steps?: Step[]; programs?: Record<string, string>; lanes?: Lanes }
/** Validate a candidate program and turn it into runnable JS (one string, or one per arm). */
function toSource(input: ProgramInput): { src: ProgramSource } | { error: string; problems?: string[] } {
  const sim = host.sim;
  if (multi()) {
    if (input.lanes) {
      const errs = validateLanes(input.lanes, (r) => stepEnv(r), sim.robotIds);
      if (errs.length) return { error: 'Invalid lanes', problems: errs.slice(0, 12) };
      return { src: lanesToJs(input.lanes) };
    }
    if (input.programs) {
      const unknown = Object.keys(input.programs).filter((r) => !sim.robotIds.includes(r));
      if (unknown.length) return { error: `Unknown arm(s) ${unknown.join(', ')}; arms are ${sim.robotIds.join(', ')}.` };
      return { src: Object.fromEntries(sim.robotIds.map((r) => [r, input.programs![r] ?? ''])) };
    }
    return { error: usageHint(currentWorkspace().editor) };
  }
  if (input.steps) {
    const errs = validateSteps(input.steps, stepEnv());
    if (errs.length) return { error: 'Invalid steps', problems: errs.slice(0, 12) };
    return { src: stepsToJs(input.steps) };
  }
  if (input.program) return { src: input.program };
  return { error: usageHint(currentWorkspace().editor) };
}
/** Give a dry-run sim the user's taught targets (every arm's). */
function applyTargets(sim: SimCore) { for (const r of sim.robotIds) sim.setTargets(laneTargets(currentWorkspace(), r), r); }

function makeBridge(): AgentBridge {
  const runDry = async (input: ProgramInput & { from?: 'initial' | 'current' }) => {
    const task = host.task;
    const r = toSource(input);
    if ('error' in r) return r;
    let sim: SimCore;
    if (input.from === 'current') sim = host.sim.clone();
    else { const scene = sceneForTask(task); sim = new SimCore(scene, robotsFor(scene, host.armId()), { seed: task.seed }); }
    applyTargets(sim);
    const trace = await dryRun(sim, r.src, task.predicates, { maxSimTimeSec: task.maxSimTimeSec ?? 600, seed: task.seed });
    return { ...summarizeTrace(trace, 15), _src: r.src };
  };
  return {
    editor: () => currentWorkspace().editor,
    readTask: () => {
      const t = host.task;
      const sim = host.sim;
      const targetsOf = (r: string) => Object.values({ ...sim.allTargets(r), ...laneTargets(currentWorkspace(), r) }).map((x) => ({ name: x.name, kind: x.source, pose: x.pose }));
      return {
        title: t.title, brief: t.brief, editor: currentWorkspace().editor,
        ...(sim.multi
          ? { arms: sim.robotIds.map((r) => ({ id: r, label: sim.label(r), model: sim.armOf(r).name, targets: targetsOf(r) })), note: 'Multi-arm task: one program per arm; each arm has its own targets (base frame).' }
          : { arm: ARMS[host.armId()].name, targets: targetsOf(sim.primary) }),
        goals: useApp.getState().predicates.map((p) => ({ goal: p.label, pass: p.pass, detail: p.detail })),
        inputs: host.sim.scene.io.inputs.map((i) => i.name), outputs: host.sim.scene.io.outputs.map((o) => o.name),
        ...(agentFeatures().plans ? { plan: planSummary(useApp.getState().plans[useApp.getState().taskId]) ?? 'No plan yet.' } : {}),
      };
    },
    readProgram: () => {
      const ws = currentWorkspace();
      const strip = (c: string) => c.replace(/await __hl\('[^']*'\);\n/g, '');
      if (ws.lanes) {
        if (ws.editor === 'code') return { editor: 'code', programs: Object.fromEntries(Object.entries(ws.lanes).map(([r, l]) => [r, l.code])) };
        const src = programSource();
        return { editor: 'blocks', lanes: workspaceJsonToLanes(ws.blocks), generatedJs: typeof src === 'string' ? strip(src) : Object.fromEntries(Object.entries(src).map(([r, c]) => [r, strip(c)])) };
      }
      if (ws.editor === 'code') return { editor: 'code', program: ws.code };
      const src = programSource();
      return { editor: 'blocks', steps: workspaceJsonToSteps(ws.blocks), generatedJs: strip(typeof src === 'string' ? src : '') };
    },
    readSimState: () => host.sim.agentView(),
    readLastRun: () => summarizeTrace(useApp.getState().lastTrace),
    searchDocs: (q) => searchDocs(q).map((c) => ({ section: c.title, text: c.text })),
    dryRun: async (input) => { const r = await runDry(input); const { _src, ...rest } = r as Record<string, unknown>; void _src; return rest; },
    propose: async (input) => {
      const editor = currentWorkspace().editor;
      const m = multi();
      const ok = m ? (editor === 'blocks' ? !!input.lanes : !!input.programs) : (editor === 'blocks' ? !!input.steps : !!input.program);
      if (!ok) return { error: `The user is in ${editor} mode. ${usageHint(editor)}` };
      const r = toSource(input);
      if ('error' in r) return { ...r, error: `${r.error} — nothing was shown to the user.` };
      const dr = (await runDry(input)) as { outcome?: string; goals?: { pass: boolean }[]; fault?: unknown };
      const proposal: Proposal = {
        id: `p${Date.now().toString(36)}`, kind: editor, explanation: input.explanation,
        newProgram: input.program, newPrograms: m && editor === 'code' ? (r.src as Record<string, string>) : undefined,
        blocksJson: input.lanes ? lanesToWorkspaceJson(input.lanes, laneLabels(), host.sim.robotIds) : input.steps ? stepsToWorkspaceJson(input.steps) : undefined,
        status: 'pending', createdAt: Date.now(),
        dryRun: { outcome: dr.outcome ?? 'error', passed: dr.goals?.filter((g) => g.pass).length ?? 0, total: dr.goals?.length ?? 0 },
      };
      Object.assign(proposal, { steps: input.steps, lanes: input.lanes });
      pushMsg({ id: nid(), role: 'proposal', text: input.explanation, proposal });
      logEvent('agent_proposal', { proposalId: proposal.id, kind: editor, program: input.program, programs: input.programs, steps: input.steps, lanes: input.lanes, explanation: input.explanation, dryRun: proposal.dryRun, promptVersion: PROMPT_VERSION });
      return { shownToUser: true, proposalId: proposal.id, dryRun: proposal.dryRun, note: 'The user now sees a preview with Accept / Reject. Summarize the change in one or two sentences; do not repeat the program.' };
    },
    showBlocks: ({ steps, lanes, caption }) => {
      // a picture may use positions the user has not taught yet; everything else must be valid
      const loose = (errs: string[]) => errs.filter((e) => !/unknown target/.test(e));
      let json: object;
      if (lanes && multi()) {
        const order = host.sim.robotIds.filter((r) => r in lanes);
        const errs = loose(validateLanes(Object.fromEntries(order.map((r) => [r, lanes[r]])), (r) => stepEnv(r), order));
        if (errs.length) return { error: 'Invalid lanes — nothing was shown.', problems: errs.slice(0, 12) };
        json = lanesToWorkspaceJson(lanes, laneLabels(), order);
      } else {
        if (!Array.isArray(steps) || !steps.length) return { error: multi() ? 'Pass {"lanes": {...}} (or a steps array for one arm).' : 'Pass a non-empty steps array.' };
        const errs = loose(validateSteps(steps, { ...stepEnv(), lanes: multi() }));
        if (errs.length) return { error: 'Invalid steps — nothing was shown.', problems: errs.slice(0, 12) };
        json = stepsToWorkspaceJson(steps);
      }
      pushVisual({ id: nid(), role: 'visual', text: caption ?? '', visual: { kind: 'blocks', json, caption } });
      logEvent('agent_visual', { kind: 'blocks', steps, lanes, caption });
      return { shownToUser: true, note: 'The picture is in the chat. Refer to it briefly; do not repeat the steps as text.' };
    },
    showExample: ({ clip, caption }) => {
      const c = clipById(clip);
      if (!c) return { error: `Unknown clip ${clip}.` };
      pushVisual({ id: nid(), role: 'visual', text: caption ?? c.title, visual: { kind: 'clip', clip, caption: caption ?? c.title } });
      logEvent('agent_visual', { kind: 'clip', clip, caption });
      return { shownToUser: true, clip: c.title, note: 'The GIF is playing in the chat. Add one or two sentences on what to notice.' };
    },
    makePlan: ({ title, steps }) => {
      const st = useApp.getState();
      const plan = { id: `plan${Date.now().toString(36)}`, title, createdAt: Date.now(), steps: steps.map((x) => ({ text: x.text, check: normalizeCheck(x.check), done: false })) };
      st.set((s) => ({ plans: { ...s.plans, [s.taskId]: plan } }));
      pushVisual({ id: nid(), role: 'plan', text: title, planId: plan.id });
      logEvent('agent_plan', { planId: plan.id, title, steps: plan.steps.map((x) => ({ text: x.text, check: x.check })) });
      return { shownToUser: true, planId: plan.id, note: 'The checklist is pinned in the chat and ticks itself off. Introduce it in one sentence; do not list the steps again.' };
    },
    previewProposal: async ({ proposalId }) => {
      const msgs = useApp.getState().chats[useApp.getState().taskId] ?? [];
      const m = [...msgs].reverse().find((x) => x.proposal && x.proposal.status === 'pending' && (!proposalId || x.proposal.id === proposalId));
      if (!m?.proposal) return { error: 'No pending proposal to preview.' };
      return previewProposal(m.proposal, 'agent');
    },
  };
}

function normalizeCheck(c?: Record<string, unknown>): PlanCheck | undefined {
  if (!c || typeof c.type !== 'string') return undefined;
  switch (c.type) {
    case 'target': return { type: 'target', name: typeof c.name === 'string' && c.name ? c.name : undefined };
    case 'uses': return typeof c.command === 'string' ? { type: 'uses', command: c.command as Extract<PlanCheck, { type: 'uses' }>['command'] } : undefined;
    case 'screen': return typeof c.screen === 'string' ? { type: 'screen', screen: c.screen as Extract<PlanCheck, { type: 'screen' }>['screen'] } : undefined;
    case 'holding': return { type: 'holding' };
    case 'run': return { type: 'run' };
    case 'goal': return typeof c.index === 'number' ? { type: 'goal', index: c.index } : undefined;
  }
  return undefined;
}

/** Replays a proposal on the ghost arm from the robot's current pose. Nothing real moves. */
export async function previewProposal(p: Proposal, source: 'agent' | 'user') {
  const st = useApp.getState();
  if (st.runState !== 'idle') return { error: 'A program is running; preview after it stops.' };
  const { steps, lanes } = p as Proposal & { steps?: Step[]; lanes?: Lanes };
  const src: ProgramSource | undefined = p.kind === 'code' ? p.newPrograms ?? p.newProgram : lanes ? lanesToJs(lanes) : steps ? stepsToJs(steps) : undefined;
  if (!src) return { error: 'Nothing to preview.' };
  host.syncTargets();
  const trace = await dryRun(host.sim, src, host.task.predicates, { maxSimTimeSec: Math.min(120, host.task.maxSimTimeSec ?? 120), seed: host.task.seed, recordEvery: 1 / 30 });
  const frames = trace.frames ?? [];
  if (frames.length < 2) return { error: 'The preview has no motion.' };
  const speed = Math.max(1, Math.min(4, frames[frames.length - 1].t / 12)); // keep long previews under ~12 s
  playGhost({ frames, speed, label: p.explanation });
  logEvent('preview_play', { proposalId: p.id, source, simSec: frames[frames.length - 1].t, outcome: trace.outcome });
  return { playing: true, seconds: Math.round(frames[frames.length - 1].t / speed), outcome: trace.outcome, note: 'The ghost robot is replaying the proposal in the 3D view now.' };
}

export async function sendToAgent(text: string) {
  const st = useApp.getState();
  const mode = agentMode();
  if (mode === 'off' || st.agentBusy || !text.trim()) return;
  const taskId = st.taskId;
  const model = activeModel();
  pushMsg({ id: nid(), role: 'user', text });
  logEvent('agent_user_msg', { text, model, promptVersion: PROMPT_VERSION });
  if (!agentConfigured()) {
    pushMsg({ id: nid(), role: 'error', text: 'The AI partner is not connected in this build (no LLM proxy URL configured).' });
    return;
  }
  st.set({ agentBusy: true });
  abort = new AbortController();
  const ws = currentWorkspace();
  const sim = host.sim;
  const system = systemPrompt({
    taskTitle: host.task.title, taskBrief: host.task.brief, armName: ARMS[host.armId()].name, editor: ws.editor, mode,
    targets: Object.keys(sim.allTargets()), inputs: sim.scene.io.inputs.map((i) => i.name), outputs: sim.scene.io.outputs.map((o) => o.name),
    features: agentFeatures(),
    ...(sim.multi ? { arms: sim.robotIds.map((r) => ({ id: r, label: sim.label(r), targets: Object.keys({ ...sim.allTargets(r), ...laneTargets(ws, r) }) })) } : {}),
  });
  const tools = makeTools(makeBridge(), mode, agentFeatures(), sim.multi);
  const llm = makeModel(model, { getToken: getIdToken, sessionId: () => useApp.getState().study?.sessionId ?? null });
  let current: string | null = null;
  /** Did this turn put anything in the chat (text, a tool pill, a visual)? */
  let shownThisTurn = false;
  const toolMsgs = new Map<string, string>();
  const toolStart = new Map<string, number>();
  const cb = {
    onToken: (t: string) => {
      shownThisTurn = true;
      if (!current) { current = nid(); pushMsg({ id: current, role: 'assistant', text: '' }); }
      const id = current;
      patchMsg(id, (m) => ({ text: m.text + t }));
    },
    onToolStart: (id: string, name: string, args: unknown) => {
      current = null;
      shownThisTurn = true;
      const mid = nid(); toolMsgs.set(id, mid); toolStart.set(id, performance.now());
      pushMsg({ id: mid, role: 'tool', text: '', tool: { name, status: 'running' } });
      void args;
    },
    onToolEnd: (id: string, name: string, output: string) => {
      const mid = toolMsgs.get(id);
      const isErr = /^\s*(\{"error"|Error)/.test(output);
      if (mid) patchMsg(mid, { tool: { name, status: isErr ? 'error' : 'done' } });
      flushVisuals();
      logEvent('agent_tool_call', { name, result: output.slice(0, 4000), durationMs: Math.round(performance.now() - (toolStart.get(id) ?? performance.now())), promptVersion: PROMPT_VERSION });
    },
    onModelMessage: (m: AIMessage, latencyMs: number) => {
      const usage = (m as AIMessage & { usage_metadata?: { input_tokens: number; output_tokens: number } }).usage_metadata;
      const finish = (m.response_metadata as { finish_reason?: string } | undefined)?.finish_reason;
      logEvent('agent_model_msg', { text: typeof m.content === 'string' ? m.content : '', toolCalls: m.tool_calls?.map((t) => ({ name: t.name, args: t.args })), model, latencyMs: Math.round(latencyMs), tokens: usage, finish, ...(isReasoningModel(model) ? { reasoningEffort: REASONING_EFFORT } : {}), promptVersion: PROMPT_VERSION });
    },
  };
  try {
    const history = histories[taskId] ?? [];
    const useJson = noToolModels.has(model);
    const run = (json: boolean) => (json ? runJsonProtocolTurn : runAgentTurn)({ model: llm, tools, system, history, userText: text, signal: abort!.signal, cb });
    let result: BaseMessage[];
    try { result = await run(useJson); }
    catch (e) {
      if (!useJson && /tool|function/i.test(String((e as Error).message)) && /support|not allowed|invalid/i.test(String((e as Error).message))) {
        noToolModels.add(model);
        result = await run(true);
      } else throw e;
    }
    histories[taskId] = result;
    // A turn can end with nothing to show: no text, no tool call (e.g. the model spent its whole output
    // budget thinking). Never leave the user looking at a blank chat.
    const last = result[result.length - 1] as AIMessage | undefined;
    const reply = typeof last?.content === 'string' ? last.content.trim() : '';
    if (last && last.getType?.() === 'ai' && !reply && !last.tool_calls?.length && !shownThisTurn) {
      const finish = (last.response_metadata as { finish_reason?: string } | undefined)?.finish_reason;
      pushMsg({ id: nid(), role: 'error', text: finish === 'length'
        ? 'I ran out of room to think before I could answer. Try asking again, or ask about one step at a time.'
        : 'I didn’t come up with an answer that time. Try asking again, maybe in different words.' });
      logEvent('agent_error', { reason: 'empty_reply', finish, model });
    }
  } catch (e) {
    const err = e as Error & { status?: number; error?: { error?: string } };
    if (err.name === 'AbortError') pushMsg({ id: nid(), role: 'error', text: 'Stopped.' });
    else {
      const status = err.status ?? (err as unknown as { response?: { status?: number } }).response?.status;
      const text = status === 429 ? 'You’ve reached the AI partner’s usage limit for today. The simulator keeps working — try again tomorrow.'
        : status === 503 ? 'The AI partner is temporarily switched off by the study team.'
        : status === 401 || status === 403 ? 'The AI partner isn’t available for this session.'
        : `The AI partner ran into a problem: ${err.message}`;
      pushMsg({ id: nid(), role: 'error', text });
      logEvent('agent_error', { status, message: err.message });
    }
  } finally {
    flushVisuals();
    useApp.getState().set({ agentBusy: false });
    abort = null;
  }
}

export function stopAgent() { abort?.abort(); }

export function decideProposal(msgId: string, decision: 'accepted' | 'rejected' | 'edited', editedProgram?: string) {
  const msg = (useApp.getState().chats[useApp.getState().taskId] ?? []).find((m) => m.id === msgId);
  const p = msg?.proposal;
  if (!p || p.status !== 'pending') return;
  if (decision !== 'rejected') {
    const ws = currentWorkspace();
    if (p.kind === 'code' && p.newPrograms && ws.lanes) {
      const edited = editedProgram !== undefined ? splitLanes(editedProgram) : null;
      const progs = edited && typeof edited !== 'string' ? edited : p.newPrograms;
      updateWorkspace({ lanes: Object.fromEntries(Object.entries(ws.lanes).map(([r, l]) => [r, { ...l, code: progs[r] ?? l.code }])) });
    }
    else if (p.kind === 'code') updateWorkspace({ code: editedProgram ?? p.newProgram ?? '' });
    else updateWorkspace({ blocks: { ...(p.blocksJson as object), __external: true } });
  }
  patchMsg(msgId, { proposal: { ...p, status: decision } });
  logEvent('agent_proposal_decision', { proposalId: p.id, decision: decision === 'edited' ? 'edited_then_applied' : decision, timeToDecisionMs: Date.now() - p.createdAt, editedProgram });
  // tell the model what happened on its next turn
  const note = decision === 'rejected' ? '(The user rejected your last proposal.)' : '(The user applied your last proposal.)';
  const h = histories[useApp.getState().taskId];
  if (h) h.push(new HumanMessage(note));
}

export const taskTitle = (id: string) => TASKS[id]?.title ?? id;
