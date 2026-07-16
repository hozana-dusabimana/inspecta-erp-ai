import { AiProvider, ChatMessage, ToolSpec } from './providers';
import { Actor, executeWriteTool, ToolRunContext } from './write-tools';

export interface AgentResult {
  text: string;
  toolCallsMade: number;
  committed: boolean;
  provider: string;
  model: string;
}

/**
 * Bounded agentic tool-calling loop. The model may call read/lookup and
 * preview/commit tools; each result is fed back until it produces a plain-text
 * answer (a slot-filling question, a preview to confirm, or a final reply).
 * Capped iterations prevent runaway loops. Actual writes are gated inside the
 * tools (permission + preview→confirm), not here.
 */
export async function runAgent(
  provider: AiProvider,
  messages: ChatMessage[],
  tools: ToolSpec[],
  actor: Actor,
  ctx: ToolRunContext,
  maxIterations = 6,
): Promise<AgentResult> {
  const convo: ChatMessage[] = [...messages];
  let committed = false;
  let toolCallsMade = 0;
  let model = provider.name;

  for (let i = 0; i < maxIterations; i++) {
    const completion = await provider.complete(convo, { tools, toolChoice: 'auto' });
    model = completion.model;
    const calls = completion.toolCalls ?? [];
    if (!calls.length) {
      return { text: completion.text, toolCallsMade, committed, provider: provider.name, model };
    }

    // Record the assistant's tool-call turn, then run each call and feed results back.
    convo.push({ role: 'assistant', content: completion.text ?? '', tool_calls: calls });
    for (const call of calls) {
      toolCallsMade++;
      const result = await executeWriteTool(call.name, call.arguments, actor, ctx);
      if (result && typeof result === 'object' && (result as { created?: boolean }).created) {
        committed = true;
      }
      convo.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: JSON.stringify(result) });
    }
  }

  // Iteration budget exhausted — get a final text answer with tools disabled.
  const final = await provider.complete(convo, { toolChoice: 'none' });
  return {
    text: final.text || 'I need a bit more information before I can continue — could you clarify?',
    toolCallsMade,
    committed,
    provider: provider.name,
    model: final.model || model,
  };
}
