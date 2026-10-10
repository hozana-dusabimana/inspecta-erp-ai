import { randomUUID } from 'crypto';
import { env } from '../../config/env';
import { satelliteChat, satelliteConfigured, stripDataUrl } from './satellite';

/** A tool/function call the model asked us to run. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** A file or image the user attached to a message (base64, no data: prefix needed). */
export interface Attachment {
  kind: 'image' | 'file';
  filename: string;
  mime: string;
  data: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Images/documents on a `user` message. Sent natively by Satellite; ignored by other providers. */
  attachments?: Attachment[];
  /** Present on assistant messages that requested tool calls (OpenAI shape). */
  tool_calls?: ToolCall[];
  /** Present on `role:'tool'` result messages — links back to the call. */
  tool_call_id?: string;
  /** Tool name, for `role:'tool'` messages. */
  name?: string;
}

/** An OpenAI-style function tool definition exposed to the model. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
}

export interface CompleteOptions {
  tools?: ToolSpec[];
  toolChoice?: 'auto' | 'none' | 'required';
}

export interface AiCompletion {
  text: string;
  provider: string;
  model: string;
  /** Tool calls the model requested this turn (empty/absent when it answered with text). */
  toolCalls?: ToolCall[];
  finishReason?: string;
}

export interface AiProvider {
  readonly name: string;
  isConfigured(): boolean;
  /** `opts.tools` engages function calling (Satellite emulated, OpenRouter native); without it, plain text. */
  complete(messages: ChatMessage[], opts?: CompleteOptions): Promise<AiCompletion>;
  /** Whether this provider can do function/tool calling. */
  supportsTools?: boolean;
}

/** Serialize our ChatMessage[] into the OpenAI/OpenRouter wire shape. */
function toOpenAiMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.tool_call_id, content: m.content };
    }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      };
    }
    return { role: m.role, content: m.content };
  });
}

// ───────────────────────── Satellite (default) ─────────────────────────
// Satellite speaks chat-completions but has no native tool calls yet, so tool use
// is emulated with a JSON protocol: the model replies with ONLY
// {"tool_calls":[{"name":...,"arguments":{...}}]} to call tools; tool results go
// back as user messages. The agent loop above this layer is unchanged.

function toolProtocolPrompt(tools: ToolSpec[]): string {
  const defs = tools
    .map((t) => `- ${t.name}: ${t.description}\n  parameters (JSON Schema): ${JSON.stringify(t.parameters)}`)
    .join('\n');
  return (
    `TOOLS — you can call these tools to look things up or act:\n${defs}\n\n` +
    `HOW TO CALL A TOOL (this protocol OVERRIDES any earlier instruction about not writing tool calls or JSON):\n` +
    `- To call one or more tools, reply with ONLY this JSON object and nothing else: ` +
    `{"tool_calls":[{"name":"<tool name>","arguments":{...}}]}\n` +
    `- Tool results come back in a user message starting "TOOL RESULT". Then either call more tools the same way, or give your final answer in plain language.\n` +
    `- If no tool is needed, just answer in plain language — never output the JSON protocol to the user as an answer.`
  );
}

/** Pull a tool-call envelope out of a model reply; null when it is a plain answer. */
export function parseToolCalls(text: string, tools: ToolSpec[]): ToolCall[] | null {
  const known = new Set(tools.map((t) => t.name));
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
  const obj = parsed as { tool_calls?: unknown; tool_call?: unknown; name?: unknown };
  const raw = Array.isArray(obj.tool_calls) ? obj.tool_calls : obj.tool_call ? [obj.tool_call] : obj.name ? [obj] : [];
  const calls: ToolCall[] = [];
  for (const r of raw) {
    const c = r as { name?: unknown; arguments?: unknown; function?: { name?: unknown; arguments?: unknown } };
    const name = String(c.name ?? c.function?.name ?? '');
    if (!known.has(name)) continue;
    const args = c.arguments ?? c.function?.arguments;
    calls.push({
      id: `call_${randomUUID().slice(0, 8)}`,
      name,
      arguments: typeof args === 'string' ? safeParseArgs(args) : args && typeof args === 'object' ? (args as Record<string, unknown>) : {},
    });
  }
  return calls.length ? calls : null;
}

/** Our ChatMessage[] → Satellite wire messages (text, image_url and file parts; tool turns folded into text). */
function toSatelliteMessages(messages: ChatMessage[], tools?: ToolSpec[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      out.push({ role: 'user', content: `TOOL RESULT (${m.name ?? 'tool'}):\n${m.content}` });
    } else if (m.role === 'assistant' && m.tool_calls?.length) {
      out.push({
        role: 'assistant',
        content: JSON.stringify({ tool_calls: m.tool_calls.map((tc) => ({ name: tc.name, arguments: tc.arguments })) }),
      });
    } else if (m.role === 'user' && m.attachments?.length) {
      out.push({
        role: 'user',
        content: [
          ...m.attachments.map((a) =>
            a.kind === 'image'
              ? { type: 'image_url', image_url: { url: `data:${a.mime};base64,${stripDataUrl(a.data)}` } }
              : { type: 'file', file: { filename: a.filename, file_data: stripDataUrl(a.data) } },
          ),
          { type: 'text', text: m.content },
        ],
      });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  if (tools?.length) {
    const idx = out.findIndex((m) => m.role === 'system');
    const proto = toolProtocolPrompt(tools);
    if (idx >= 0) out[idx] = { role: 'system', content: `${out[idx].content as string}\n\n${proto}` };
    else out.unshift({ role: 'system', content: proto });
  }
  return out;
}

class SatelliteProvider implements AiProvider {
  readonly name = 'satellite';
  readonly supportsTools = true;
  isConfigured() {
    return satelliteConfigured();
  }
  async complete(messages: ChatMessage[], opts?: CompleteOptions): Promise<AiCompletion> {
    const tools = opts?.toolChoice === 'none' ? undefined : opts?.tools;
    const r = await satelliteChat(toSatelliteMessages(messages, tools));
    const toolCalls = tools?.length ? parseToolCalls(r.text, tools) : null;
    return {
      text: toolCalls ? '' : r.text,
      provider: this.name,
      model: r.model,
      toolCalls: toolCalls ?? undefined,
      finishReason: r.finishReason,
    };
  }
}

// ───────────────────────── OpenRouter (fallback) ─────────────────────────
class OpenRouterProvider implements AiProvider {
  readonly name = 'openrouter';
  readonly supportsTools = true;
  isConfigured() {
    return Boolean(env.ai.openrouter.apiKey);
  }
  async complete(messages: ChatMessage[], opts?: CompleteOptions): Promise<AiCompletion> {
    const body: Record<string, unknown> = {
      model: env.ai.openrouter.model,
      messages: toOpenAiMessages(messages),
    };
    if (opts?.tools?.length) {
      body.tools = opts.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body.tool_choice = opts.toolChoice ?? 'auto';
    }

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.ai.openrouter.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': env.corsOrigin,
        'X-Title': 'Inspecta BuildOS',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`OpenRouter error ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      choices: {
        message: {
          content: string | null;
          tool_calls?: { id: string; function: { name: string; arguments: string } }[];
        };
        finish_reason?: string;
      }[];
    };
    const msg = json.choices?.[0]?.message;
    const toolCalls: ToolCall[] = (msg?.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: safeParseArgs(tc.function.arguments),
    }));
    return {
      text: msg?.content ?? '',
      provider: this.name,
      model: env.ai.openrouter.model,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      finishReason: json.choices?.[0]?.finish_reason,
    };
  }
}

/** Tool-call arguments arrive as a JSON string; tolerate malformed output. */
function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// ───────────────────────── Anthropic Claude ─────────────────────────
class ClaudeProvider implements AiProvider {
  readonly name = 'claude';
  isConfigured() {
    return Boolean(env.ai.claude.apiKey);
  }
  async complete(messages: ChatMessage[]): Promise<AiCompletion> {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const turns = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ai.claude.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.ai.claude.model,
        max_tokens: 1500,
        system,
        messages: turns,
      }),
    });
    if (!res.ok) {
      throw new Error(`Claude error ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as { content: { text: string }[] };
    return {
      text: json.content?.map((c) => c.text).join('') ?? '',
      provider: this.name,
      model: env.ai.claude.model,
    };
  }
}

// ───────────────────────── Google Gemini ─────────────────────────
class GeminiProvider implements AiProvider {
  readonly name = 'gemini';
  isConfigured() {
    return Boolean(env.ai.gemini.apiKey);
  }
  async complete(messages: ChatMessage[]): Promise<AiCompletion> {
    const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.ai.gemini.model}:generateContent?key=${env.ai.gemini.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents,
      }),
    });
    if (!res.ok) {
      throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    return {
      text: json.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '',
      provider: this.name,
      model: env.ai.gemini.model,
    };
  }
}

const registry: Record<string, AiProvider> = {
  satellite: new SatelliteProvider(),
  openrouter: new OpenRouterProvider(),
  claude: new ClaudeProvider(),
  gemini: new GeminiProvider(),
};

/** Resolve a provider by name, falling back to the configured default. */
export function getProvider(preferred?: string): AiProvider {
  const key = (preferred ?? env.ai.provider).toLowerCase();
  return registry[key] ?? registry.satellite;
}

export function anyConfiguredProvider(): AiProvider | null {
  const order = [env.ai.provider, 'satellite', 'openrouter', 'claude', 'gemini'];
  for (const name of order) {
    const p = registry[name];
    if (p && p.isConfigured()) return p;
  }
  return null;
}
