import { env } from '../../config/env';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiCompletion {
  text: string;
  provider: string;
  model: string;
}

export interface AiProvider {
  readonly name: string;
  isConfigured(): boolean;
  complete(messages: ChatMessage[]): Promise<AiCompletion>;
}

// ───────────────────────── OpenRouter (default) ─────────────────────────
class OpenRouterProvider implements AiProvider {
  readonly name = 'openrouter';
  isConfigured() {
    return Boolean(env.ai.openrouter.apiKey);
  }
  async complete(messages: ChatMessage[]): Promise<AiCompletion> {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.ai.openrouter.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': env.corsOrigin,
        'X-Title': 'Inspecta BuildOS',
      },
      body: JSON.stringify({ model: env.ai.openrouter.model, messages }),
    });
    if (!res.ok) {
      throw new Error(`OpenRouter error ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as { choices: { message: { content: string } }[] };
    return {
      text: json.choices?.[0]?.message?.content ?? '',
      provider: this.name,
      model: env.ai.openrouter.model,
    };
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
