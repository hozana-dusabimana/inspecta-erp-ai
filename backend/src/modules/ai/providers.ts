import { env } from '../../config/env';

/** A tool/function call the model asked us to run. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
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
  /** `opts.tools` engages function calling (OpenRouter only); without it, plain text. */
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

// ───────────────────────── OpenRouter (default) ─────────────────────────
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
  openrouter: new OpenRouterProvider(),
  claude: new ClaudeProvider(),
  gemini: new GeminiProvider(),
};

/** Resolve a provider by name, falling back to the configured default. */
export function getProvider(preferred?: string): AiProvider {
  const key = (preferred ?? env.ai.provider).toLowerCase();
  return registry[key] ?? registry.openrouter;
}

export function anyConfiguredProvider(): AiProvider | null {
  const order = [env.ai.provider, 'openrouter', 'claude', 'gemini'];
  for (const name of order) {
    const p = registry[name];
    if (p && p.isConfigured()) return p;
  }
  return null;
}
