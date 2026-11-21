import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import type { Lanes, Step } from '../blocks/steps';
import type { AgentFeatures } from '../store';
import { CLIPS, CLIP_IDS } from './clips';

/** A candidate program: single-arm (program / steps) or multi-arm (programs / lanes, keyed by robot id). */
export interface ProgramArgs { program?: string; steps?: Step[]; programs?: Record<string, string>; lanes?: Lanes }
export interface AgentBridge {
  editor(): 'blocks' | 'code';
  readTask(): unknown;
  readProgram(): unknown;
  readSimState(): unknown;
  readLastRun(): unknown;
  searchDocs(query: string): unknown;
  dryRun(input: ProgramArgs & { from?: 'initial' | 'current' }): Promise<unknown>;
  propose(input: ProgramArgs & { explanation: string }): Promise<unknown>;
  showBlocks(input: { steps?: Step[]; lanes?: Lanes; caption?: string }): unknown;
  showExample(input: { clip: string; caption?: string }): unknown;
  makePlan(input: { title: string; steps: { text: string; check?: Record<string, unknown> }[] }): unknown;
  previewProposal(input: { proposalId?: string }): Promise<unknown>;
}

const CHECK_TYPES = ['target', 'uses', 'screen', 'holding', 'run', 'goal'] as const;
const COMMANDS = ['moveJ', 'moveL', 'home', 'gripper.open', 'gripper.close', 'waitFor', 'io.set', 'wait', 'loop', 'offset'] as const;
const SCREENS = ['home', 'task', 'program', 'jog', 'positions', 'io', 'log', 'settings'] as const;

const MAX = 6000;
const out = (v: unknown) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > MAX ? s.slice(0, MAX) + ' …[truncated]' : s; };
const singleInput = {
  program: z.string().optional().describe('Full JavaScript program (code mode).'),
  steps: z.array(z.record(z.string(), z.any())).optional().describe('Full block program as JSON steps (blocks mode).'),
};
const LANES = z.record(z.string(), z.array(z.record(z.string(), z.any())));
/** Multi-arm tasks add per-arm programs; single-arm tool schemas stay exactly as before (study comparability). */
const multiInput = {
  ...singleInput,
  programs: z.record(z.string(), z.string()).optional().describe('MULTI-ARM code mode: one full JavaScript program per arm id, e.g. {"A": "...", "B": "..."}.'),
  lanes: LANES.optional().describe('MULTI-ARM blocks mode: one step list per arm id, e.g. {"A": [...], "B": [...]}.'),
};
const args = (a: { program?: string; steps?: unknown[]; programs?: Record<string, string>; lanes?: Record<string, unknown[]> }): ProgramArgs =>
  ({ program: a.program, steps: a.steps as Step[] | undefined, programs: a.programs, lanes: a.lanes as Lanes | undefined });

export function makeTools(b: AgentBridge, mode: 'qa' | 'suggest', features: AgentFeatures, multi = false): StructuredToolInterface[] {
  const programInput = multi ? multiInput : singleInput;
  const tools: StructuredToolInterface[] = [
    tool(async () => out(b.readTask()), { name: 'read_task', description: 'Task brief, goals (with live pass/fail), editor mode and available targets/signals.', schema: z.object({}) }),
    tool(async () => out(b.readProgram()), { name: 'read_program', description: 'The user’s current program (JavaScript in code mode; JSON steps + generated JavaScript in blocks mode).', schema: z.object({}) }),
    tool(async () => out(b.readSimState()), { name: 'read_sim_state', description: 'Live robot state: joints, tool pose, gripper, objects, signals, last fault.', schema: z.object({}) }),
    tool(async () => out(b.readLastRun() ?? 'No run yet.'), { name: 'read_last_run', description: 'Trace of the user’s most recent run: each command, its line/block, and the fault if any.', schema: z.object({}) }),
    tool(async ({ query }) => out(b.searchDocs(query)), { name: 'search_docs', description: 'Search the robot API reference, block reference, cobot concepts, and the guide to the teach-pendant apps (Home, Program, Jog, Positions, I/O, Log, Settings, run keys).', schema: z.object({ query: z.string() }) }),
  ];
  if (mode === 'suggest') {
    tools.push(
      tool(async (a) => out(await b.dryRun({ ...args(a), from: a.from })), {
        name: 'dry_run',
        description: 'Run a candidate program on a hidden copy of the cell (starting from the task’s initial state by default) and return the trace, fault and goal results. The user’s scene is not affected.',
        schema: z.object({ ...programInput, from: z.enum(['initial', 'current']).optional() }),
      }),
      tool(async (a) => out(await b.propose({ ...args(a), explanation: a.explanation })), {
        name: 'propose_patch',
        description: 'Show the user a proposed replacement program. They see a preview and accept or reject it. Pass the COMPLETE program.',
        schema: z.object({ ...programInput, explanation: z.string().describe('One or two sentences: what changed and why.') }),
      }),
    );
  }
  if (features.visuals) {
    tools.push(
      multi
        ? tool(async (a) => out(b.showBlocks({ steps: a.steps as Step[] | undefined, lanes: a.lanes as Lanes | undefined, caption: a.caption })), {
          name: 'show_blocks',
          description: 'Show the user a picture of blocks in the chat (read-only). Use it to illustrate a pattern or the exact blocks to add, in either editor mode. Pass {"lanes": {...}} to draw several arms side by side (sync blocks line up), or a short steps array for one arm. Targets that are not taught yet are allowed.',
          schema: z.object({ steps: z.array(z.record(z.string(), z.any())).optional().describe('JSON steps for one arm.'), lanes: LANES.optional().describe('JSON steps per arm id, drawn side by side.'), caption: z.string().optional().describe('One short line under the picture.') }),
        })
        : tool(async (a) => out(b.showBlocks({ steps: a.steps as Step[], caption: a.caption })), {
          name: 'show_blocks',
          description: 'Show the user a picture of blocks in the chat (read-only). Use it to illustrate a pattern or the exact blocks to add, in either editor mode. Pass a short snippet of JSON steps, not necessarily a whole program. Targets that are not taught yet are allowed.',
          schema: z.object({ steps: z.array(z.record(z.string(), z.any())).describe('JSON steps to draw (same format as block programs).'), caption: z.string().optional().describe('One short line under the picture.') }),
        }),
      tool(async (a) => out(b.showExample(a)), {
        name: 'show_example',
        description: `Show a short looping GIF recorded in Tandem that demonstrates a skill. Use it when seeing it done is clearer than words. Clips: ${CLIPS.map((c) => `${c.id} (${c.about})`).join('; ')}`,
        schema: z.object({ clip: z.enum(CLIP_IDS), caption: z.string().optional() }),
      }),
    );
  }
  if (features.plans) {
    tools.push(tool(async (a) => out(b.makePlan(a as Parameters<AgentBridge['makePlan']>[0])), {
      name: 'make_plan',
      description: 'Give the user a step-by-step checklist for the task (3–7 short steps). It stays pinned in the chat and ticks itself off as they make progress. Making a new plan replaces the old one. Add a check to each step when one fits: target (a taught position exists; name optional), uses (the program contains a command), screen (they opened a pendant screen), holding (gripper holds a part), run (a run completed), goal (task goal at 0-based index passes). Steps without a check are ticked by the user.',
      schema: z.object({
        title: z.string(),
        steps: z.array(z.object({
          text: z.string().describe('Imperative, under 12 words.'),
          check: z.object({ type: z.enum(CHECK_TYPES), name: z.string().optional(), command: z.enum(COMMANDS).optional(), screen: z.enum(SCREENS).optional(), index: z.number().optional() }).optional(),
        })).min(1).max(8),
      }),
    }));
  }
  if (features.preview && mode === 'suggest') {
    tools.push(tool(async (a) => out(await b.previewProposal(a)), {
      name: 'preview_proposal',
      description: 'Play your pending proposal on a translucent "ghost" robot in the 3D view, starting from where the robot is now, so the user can watch it before accepting. Nothing real moves. Defaults to the latest pending proposal.',
      schema: z.object({ proposalId: z.string().optional() }),
    }));
  }
  return tools;
}
