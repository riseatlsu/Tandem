/**
 * Fallback for models without native tool calling: the model emits one fenced ```action block
 * {"tool": "...", "args": {...}}; we run the tool and feed the result back. Plain prose = final answer.
 */
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { MAX_TOOL_CALLS, trimHistory, type TurnCallbacks } from './graph';

const ActionZ = z.object({ tool: z.string(), args: z.record(z.string(), z.any()).default({}) });

export function protocolInstructions(tools: StructuredToolInterface[]) {
  return `\n\n## Tool protocol\nTo use a tool, reply with ONLY one fenced block:\n\`\`\`action\n{"tool": "<name>", "args": { ... }}\n\`\`\`\nYou will receive the result in the next message. When you are done, reply in plain prose without an action block.\nTools: ${tools.map((t) => `${t.name} — ${t.description}`).join('; ')}`;
}

export function parseAction(text: string): z.infer<typeof ActionZ> | { error: string } | null {
  const m = text.match(/```action\s*([\s\S]*?)```/);
  if (!m) return null;
  try { const r = ActionZ.safeParse(JSON.parse(m[1])); return r.success ? r.data : { error: r.error.issues.map((i) => i.message).join('; ') }; }
  catch (e) { return { error: (e as Error).message }; }
}

export async function runJsonProtocolTurn(opts: { model: ChatOpenAI; tools: StructuredToolInterface[]; system: string; history: BaseMessage[]; userText: string; signal?: AbortSignal; cb: TurnCallbacks }): Promise<BaseMessage[]> {
  const msgs: BaseMessage[] = [...opts.history, new HumanMessage(opts.userText)];
  const sys = new SystemMessage(opts.system + protocolInstructions(opts.tools));
  let retried = false;
  for (let i = 0; i <= MAX_TOOL_CALLS; i++) {
    const t0 = performance.now();
    const res = (await opts.model.invoke([sys, ...trimHistory(msgs)], { signal: opts.signal })) as AIMessage;
    opts.cb.onModelMessage(res, performance.now() - t0);
    const text = typeof res.content === 'string' ? res.content : '';
    msgs.push(new AIMessage(text));
    const action = parseAction(text);
    if (!action) { opts.cb.onToken(text); return msgs; }
    if ('error' in action) {
      if (retried) { opts.cb.onToken(text.replace(/```action[\s\S]*?```/, '').trim() || 'Sorry — I could not format that tool call.'); return msgs; }
      retried = true;
      msgs.push(new HumanMessage(`Your action block could not be parsed (${action.error}). Reply with a valid block or answer in prose.`));
      continue;
    }
    const t = opts.tools.find((x) => x.name === action.tool);
    const id = `j${i}`;
    opts.cb.onToolStart(id, action.tool, action.args);
    let result: string;
    try { result = t ? String(await t.invoke(action.args)) : `Unknown tool ${action.tool}`; } catch (e) { result = `Error: ${(e as Error).message}`; }
    opts.cb.onToolEnd(id, action.tool, result);
    msgs.push(new HumanMessage(`TOOL RESULT (${action.tool}):\n${result}`));
  }
  return msgs;
}
