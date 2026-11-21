import { create } from 'zustand';
import { DEFAULT_DEMO_MODEL } from '../config';
import type { Fault, PredicateResult, Target } from '../sim/types';
import type { RunTrace } from '../runtime/protocol';
import type { RunState } from '../runtime/ProgramRunner';
import type { LaneState } from '../runtime/scheduler';

export type AgentMode = 'off' | 'qa' | 'suggest';
/** Per-condition AI-partner features (all on in the demo). */
export interface AgentFeatures { visuals: boolean; plans: boolean; preview: boolean }
export const ALL_FEATURES: AgentFeatures = { visuals: true, plans: true, preview: true };
export const NO_FEATURES: AgentFeatures = { visuals: false, plans: false, preview: false };
export type JogMode = 'axes13' | 'axes46' | 'linear' | 'reorient';
export type PendantScreen = 'home' | 'task' | 'program' | 'jog' | 'positions' | 'io' | 'log' | 'settings';
export interface StudyInfo {
  code: string; sessionId: string; experimentId: string; condition: string;
  taskSequence: string[]; agentMode: AgentMode; features: AgentFeatures; model?: string; promptVersion: string; postSurveyUrl?: string;
}
/** One arm's program in a multi-arm task (SPEC §21.2). Blocks for every lane live in `Workspace.blocks`. */
export interface Lane { code: string; targets: Record<string, Target> }
export interface Workspace {
  editor: 'blocks' | 'code';
  code: string;
  /** Blockly JSON; in multi-arm tasks it holds every lane (one "lane_start" hat per arm). */
  blocks: object | null;
  targets: Record<string, Target>;
  /** Multi-arm tasks only: per-arm code and taught targets, by robot id. `code`/`targets` above are unused there. */
  lanes?: Record<string, Lane>;
}
export interface ConsoleLine { id: number; simTime: number; text: string; kind: 'log' | 'fault' | 'info'; line?: number }
export interface ChatMsg {
  id: string; role: 'user' | 'assistant' | 'tool' | 'proposal' | 'error' | 'visual' | 'plan';
  text: string;
  visual?: ChatVisual;
  planId?: string;
  tool?: { name: string; status: 'running' | 'done' | 'error'; summary?: string };
  proposal?: Proposal;
}
export type ChatVisual =
  | { kind: 'blocks'; json: object; caption?: string }
  | { kind: 'clip'; clip: string; caption?: string };
/** A check that ticks a plan step automatically; steps without one are ticked by the user. */
export type PlanCheck =
  | { type: 'target'; name?: string }
  | { type: 'uses'; command: 'moveJ' | 'moveL' | 'home' | 'gripper.open' | 'gripper.close' | 'waitFor' | 'io.set' | 'wait' | 'loop' | 'offset' }
  | { type: 'screen'; screen: PendantScreen }
  | { type: 'holding' }
  | { type: 'run' }
  | { type: 'goal'; index: number };
export interface PlanStep { text: string; check?: PlanCheck; done: boolean }
export interface Plan { id: string; title: string; steps: PlanStep[]; createdAt: number }
export interface TourState { step: number; required: boolean }
export interface Proposal {
  id: string; kind: 'code' | 'blocks'; explanation: string;
  newProgram?: string; blocksJson?: object;
  /** Multi-arm code proposals: one program per arm. */
  newPrograms?: Record<string, string>;
  status: 'pending' | 'accepted' | 'rejected' | 'edited';
  dryRun?: { outcome: string; passed: number; total: number };
  createdAt: number;
}

interface AppState {
  route: 'landing' | 'app';
  landingMusic: boolean;
  mode: 'demo' | 'study';
  study: StudyInfo | null;
  taskIndex: number;
  taskId: string;
  armOverride: string | null;
  workspaces: Record<string, Workspace>;
  runState: RunState;
  speed: number;
  highlight: { line?: number; blockId?: string; lanes?: Record<string, { line?: number; blockId?: string }> };
  /** Multi-arm runs: what each arm's program is doing (for "Waiting for others" badges). */
  laneStates: Record<string, LaneState>;
  /** The arm that Jog, Positions, hand guide and Teach act on (robot id; "A" in single-arm cells). */
  arm: string;
  console: ConsoleLine[];
  lastTrace: RunTrace | null;
  fault: Fault | null;
  predicates: PredicateResult[];
  passed: Record<string, boolean>;
  showSuccess: boolean;
  jog: { mode: JogMode; frame: 'base' | 'tool'; step: number };
  pendantScreen: PendantScreen;
  agentOpen: boolean;
  handGuide: boolean;
  handGuideMode: 'translate' | 'rotate';
  handGuideBlocked: boolean;
  showFrames: boolean;
  chats: Record<string, ChatMsg[]>;
  plans: Record<string, Plan>;
  tour: TourState | null;
  tourDone: boolean;
  agentBusy: boolean;
  demoModel: string;
  toasts: { id: number; text: string; tone?: 'info' | 'good' | 'bad' }[];
  taskStartedAt: number;
  timeLeftSec: number | null;
  set: (p: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
}

export const useApp = create<AppState>((set) => ({
  route: 'app', landingMusic: false, mode: 'demo', study: null, taskIndex: 0, taskId: 'tut-jog-teach', armOverride: null,
  workspaces: {}, runState: 'idle', speed: 1, highlight: {}, laneStates: {}, arm: 'A', console: [], lastTrace: null, fault: null,
  predicates: [], passed: {}, showSuccess: false,
  jog: { mode: 'axes13', frame: 'base', step: 1 }, pendantScreen: 'home', agentOpen: false, handGuide: false, handGuideMode: 'translate', handGuideBlocked: false, showFrames: true,
  chats: {}, plans: {}, tour: null, tourDone: false, agentBusy: false, demoModel: DEFAULT_DEMO_MODEL, toasts: [], taskStartedAt: Date.now(), timeLeftSec: null,
  set: (p) => set(typeof p === 'function' ? p : () => p),
}));

let toastId = 1;
export function toast(text: string, tone: 'info' | 'good' | 'bad' = 'info') {
  const id = toastId++;
  useApp.getState().set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
  setTimeout(() => useApp.getState().set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4200);
}

let lineId = 1;
export function consoleLog(text: string, kind: ConsoleLine['kind'] = 'log', simTime = 0, line?: number) {
  useApp.getState().set((s) => ({ console: [...s.console.slice(-300), { id: lineId++, simTime, text, kind, line }] }));
}

export const currentWorkspace = (): Workspace => {
  const s = useApp.getState();
  return s.workspaces[s.taskId];
};
export function updateWorkspace(p: Partial<Workspace>) {
  useApp.getState().set((s) => ({ workspaces: { ...s.workspaces, [s.taskId]: { ...s.workspaces[s.taskId], ...p } } }));
}
/** Taught targets of one arm (the workspace's own targets in single-arm tasks). */
export function laneTargets(ws: Workspace | undefined, robot: string): Record<string, Target> {
  if (!ws) return {};
  return ws.lanes ? ws.lanes[robot]?.targets ?? {} : ws.targets;
}
export function updateLane(robot: string, p: Partial<Lane>) {
  const ws = currentWorkspace();
  if (!ws?.lanes) {
    if (p.targets) updateWorkspace({ targets: p.targets });
    if (p.code !== undefined) updateWorkspace({ code: p.code });
    return;
  }
  updateWorkspace({ lanes: { ...ws.lanes, [robot]: { ...ws.lanes[robot], ...p } } });
}
