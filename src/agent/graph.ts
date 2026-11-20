/**
 * Single ReAct agent (LangGraph.js): model node ⇄ tool node, ≤ 8 tool calls per user turn.
 * Runs entirely in the browser; the model is reached through the llmProxy.
 */
import { StateGraph, MessagesAnnotation, START, END } from '@langchain/langgraph/web';
import { ToolNode, toolsCondition } from '@langchain/langgraph/prebuilt';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage, AIMessageChunk } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { ChatOpenAI } from '@langchain/openai';

export const MAX_TOOL_CALLS = 8;
export interface TurnCallbacks {
  onToken(text: string): void;
  onToolStart(id: string, name: string, args: unknown): void;
  onToolEnd(id: string, name: string, output: string): void;
  onModelMessage(msg: AIMessage, latencyMs: number): void;
}

export function trimHistory(msgs: BaseMessage[], max = 24): BaseMessage[] {
  if (msgs.length <= max) return msgs;
  for (let i = msgs.length - max; i < msgs.length; i++) if (msgs[i] instanceof HumanMessage) return msgs.slice(i);
  return msgs.slice(-1);
}

function toolCallsThisTurn(msgs: BaseMessage[]): number {
  let n = 0;
  for (let i = msgs.length - 1; i >= 0; i--) { if (msgs[i] instanceof HumanMessage) break; if (msgs[i] instanceof ToolMessage) n++; }
  return n;
}

export async function runAgentTurn(opts: {
  model: ChatOpenAI; tools: StructuredToolInterface[]; system: string; history: BaseMessage[]; userText: string; signal?: AbortSignal; cb: TurnCallbacks;
}): Promise<BaseMessage[]> {
  const { model, tools, system, cb } = opts;
  const withTools = model.bindTools(tools);
  let t0 = 0;
  const agent = async (state: typeof MessagesAnnotation.State) => {
    const capped = toolCallsThisTurn(state.messages) >= MAX_TOOL_CALLS;
    const msgs = [new SystemMessage(system + (capped ? '\n\nYou have used the maximum number of tool calls for this turn. Answer now with what you know.' : '')), ...trimHistory(state.messages)];
    t0 = performance.now();
    const res = await (capped ? model : withTools).invoke(msgs, { signal: opts.signal });
    cb.onModelMessage(res as AIMessage, performance.now() - t0);
    return { messages: [res] };
  };
  const graph = new StateGraph(MessagesAnnotation)
    .addNode('agent', agent)
    .addNode('tools', new ToolNode(tools))
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', toolsCondition, ['tools', END])
    .addEdge('tools', 'agent')
    .compile();

  const input = { messages: [...opts.history, new HumanMessage(opts.userText)] };
  let final: BaseMessage[] = input.messages;
  const seen = new Set<string>();
  const stream = await graph.stream(input, { streamMode: ['messages', 'values'], recursionLimit: 2 * MAX_TOOL_CALLS + 6, signal: opts.signal });
  for await (const [mode, chunk] of stream as AsyncIterable<[string, unknown]>) {
    if (mode === 'messages') {
      const [msg, meta] = chunk as [BaseMessage, { langgraph_node?: string }];
      if (meta?.langgraph_node === 'agent' && msg instanceof AIMessageChunk && typeof msg.content === 'string' && msg.content) cb.onToken(msg.content);
    } else if (mode === 'values') {
      const msgs = (chunk as { messages: BaseMessage[] }).messages;
      final = msgs;
      for (const m of msgs) {
        if (m instanceof AIMessage && m.tool_calls?.length) {
          for (const tc of m.tool_calls) { const k = `s${tc.id}`; if (!seen.has(k)) { seen.add(k); cb.onToolStart(tc.id ?? '', tc.name, tc.args); } }
        }
        if (m instanceof ToolMessage) {
          const k = `e${m.tool_call_id}`;
          if (!seen.has(k)) { seen.add(k); cb.onToolEnd(m.tool_call_id, m.name ?? '', typeof m.content === 'string' ? m.content : JSON.stringify(m.content)); }
        }
      }
    }
  }
  return final;
}
