import { create } from 'zustand';
import type { Fault, PredicateResult, Target } from '../sim/types';
import type { RunTrace } from '../runtime/protocol';
import type { RunState } from '../runtime/ProgramRunner';

export type AgentMode = 'off' | 'qa' | 'suggest';
export interface StudyInfo {
  code: string; sessionId: string; experimentId: string; condition: string;
  taskSequence: string[]; agentMode: AgentMode; model?: string; promptVersion: string; postSurveyUrl?: string;
}
export interface Workspace {
  editor: 'blocks' | 'code';
  code: string;
  blocks: object | null;
  targets: Record<string, Target>;
}
export interface ConsoleLine { id: number; simTime: number; text: string; kind: 'log' | 'fault' | 'info'; line?: number }
export interface ChatMsg {
  id: string; role: 'user' | 'assistant' | 'tool' | 'proposal' | 'error';
  text: string;
  tool?: { name: string; status: 'running' | 'done' | 'error'; summary?: string };
  proposal?: Proposal;
}
export interface Proposal {
  id: string; kind: 'code' | 'blocks'; explanation: string;
  newProgram?: string; blocksJson?: object;
  status: 'pending' | 'accepted' | 'rejected' | 'edited';
  dryRun?: { outcome: string; passed: number; total: number };
  createdAt: number;
}

interface AppState {
  mode: 'demo' | 'study';
  study: StudyInfo | null;
  taskIndex: number;
  taskId: string;
  armOverride: string | null;
  workspaces: Record<string, Workspace>;
  runState: RunState;
  speed: number;
  highlight: { line?: number; blockId?: string };
  console: ConsoleLine[];
  lastTrace: RunTrace | null;
  fault: Fault | null;
  predicates: PredicateResult[];
  passed: Record<string, boolean>;
  showSuccess: boolean;
  jog: { mode: 'joint' | 'cart'; frame: 'base' | 'tool'; step: number };
  handGuide: boolean;
  handGuideMode: 'translate' | 'rotate';
  handGuideBlocked: boolean;
  showFrames: boolean;
  chats: Record<string, ChatMsg[]>;
  agentBusy: boolean;
  demoModel: string;
  toasts: { id: number; text: string; tone?: 'info' | 'good' | 'bad' }[];
  taskStartedAt: number;
  timeLeftSec: number | null;
  set: (p: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void;
}

export const useApp = create<AppState>((set) => ({
  mode: 'demo', study: null, taskIndex: 0, taskId: 'tut-jog-teach', armOverride: null,
  workspaces: {}, runState: 'idle', speed: 1, highlight: {}, console: [], lastTrace: null, fault: null,
  predicates: [], passed: {}, showSuccess: false,
  jog: { mode: 'joint', frame: 'base', step: 10 }, handGuide: false, handGuideMode: 'translate', handGuideBlocked: false, showFrames: true,
  chats: {}, agentBusy: false, demoModel: 'gpt-5-mini', toasts: [], taskStartedAt: Date.now(), timeLeftSec: null,
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
