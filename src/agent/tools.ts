import { tool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import type { Step } from '../blocks/steps';

export interface AgentBridge {
  editor(): 'blocks' | 'code';
  readTask(): unknown;
  readProgram(): unknown;
  readSimState(): unknown;
  readLastRun(): unknown;
  searchDocs(query: string): unknown;
  dryRun(input: { program?: string; steps?: Step[]; from?: 'initial' | 'current' }): Promise<unknown>;
  propose(input: { program?: string; steps?: Step[]; explanation: string }): Promise<unknown>;
}

const MAX = 6000;
const out = (v: unknown) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > MAX ? s.slice(0, MAX) + ' …[truncated]' : s; };
const programInput = {
  program: z.string().optional().describe('Full JavaScript program (code mode).'),
  steps: z.array(z.record(z.string(), z.any())).optional().describe('Full block program as JSON steps (blocks mode).'),
};

export function makeTools(b: AgentBridge, mode: 'qa' | 'suggest'): StructuredToolInterface[] {
  const tools: StructuredToolInterface[] = [
    tool(async () => out(b.readTask()), { name: 'read_task', description: 'Task brief, goals (with live pass/fail), editor mode and available targets/signals.', schema: z.object({}) }),
    tool(async () => out(b.readProgram()), { name: 'read_program', description: 'The user’s current program (JavaScript in code mode; JSON steps + generated JavaScript in blocks mode).', schema: z.object({}) }),
    tool(async () => out(b.readSimState()), { name: 'read_sim_state', description: 'Live robot state: joints, tool pose, gripper, objects, signals, last fault.', schema: z.object({}) }),
    tool(async () => out(b.readLastRun() ?? 'No run yet.'), { name: 'read_last_run', description: 'Trace of the user’s most recent run: each command, its line/block, and the fault if any.', schema: z.object({}) }),
    tool(async ({ query }) => out(b.searchDocs(query)), { name: 'search_docs', description: 'Search the robot API reference, block reference and cobot concepts.', schema: z.object({ query: z.string() }) }),
  ];
  if (mode === 'suggest') {
    tools.push(
      tool(async (a) => out(await b.dryRun({ program: a.program, steps: a.steps as Step[] | undefined, from: a.from })), {
        name: 'dry_run',
        description: 'Run a candidate program on a hidden copy of the cell (starting from the task’s initial state by default) and return the trace, fault and goal results. The user’s scene is not affected.',
        schema: z.object({ ...programInput, from: z.enum(['initial', 'current']).optional() }),
      }),
      tool(async (a) => out(await b.propose({ program: a.program, steps: a.steps as Step[] | undefined, explanation: a.explanation })), {
        name: 'propose_patch',
        description: 'Show the user a proposed replacement program. They see a preview and accept or reject it. Pass the COMPLETE program.',
        schema: z.object({ ...programInput, explanation: z.string().describe('One or two sentences: what changed and why.') }),
      }),
    );
  }
  return tools;
}
