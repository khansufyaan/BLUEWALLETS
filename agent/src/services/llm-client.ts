/**
 * LLM Client — talks to any OpenAI-compatible chat completions endpoint.
 *
 * Supports: Ollama, vLLM, LM Studio, LocalAI, text-generation-webui, etc.
 * All fully on-prem — no external network calls.
 */

import { config } from '../config';
import { logger } from '../logger';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

export interface ChatResponse {
  choices: Array<{
    message: ChatMessage;
    finish_reason: string;
  }>;
}

export interface StreamDelta {
  content?: string;
  tool_calls?: Array<{
    index: number;
    id?: string;
    type?: 'function';
    function?: { name?: string; arguments?: string };
  }>;
  finish_reason?: string | null;
}

export class LlmClient {
  /**
   * Stream a chat response as token deltas.
   * Accumulates tool calls across deltas (they come fragmented).
   * Yields each delta as it arrives, and returns the final assembled message at end.
   */
  async *chatStream(req: ChatRequest): AsyncGenerator<StreamDelta, ChatMessage, unknown> {
    const body = {
      model: config.llmModel,
      messages: req.messages,
      tools: req.tools,
      tool_choice: req.tools?.length ? 'auto' : undefined,
      temperature: req.temperature ?? 0.1,
      max_tokens: req.max_tokens ?? config.llmMaxTokens,
      stream: true,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 240_000);

    let res: Response;
    try {
      res = await fetch(`${config.llmUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.llmApiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }

    if (!res.ok) {
      clearTimeout(timeout);
      const text = await res.text();
      throw new Error(`LLM stream error ${res.status}: ${text.slice(0, 200)}`);
    }
    if (!res.body) {
      clearTimeout(timeout);
      throw new Error('LLM stream has no body');
    }

    // Assembled final state
    const finalMsg: ChatMessage = { role: 'assistant', content: '' };
    const toolCallAccumulator: Map<number, { id: string; name: string; arguments: string }> = new Map();

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Split on double-newline (SSE message boundary)
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;

          let chunk: any;
          try { chunk = JSON.parse(payload); } catch { continue; }
          const delta = chunk?.choices?.[0]?.delta;
          const finishReason = chunk?.choices?.[0]?.finish_reason;
          if (!delta && !finishReason) continue;

          // Accumulate content
          if (delta?.content) {
            finalMsg.content = (finalMsg.content || '') + delta.content;
          }

          // Accumulate tool calls (they arrive fragmented by index)
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              let acc = toolCallAccumulator.get(idx);
              if (!acc) {
                acc = { id: tc.id || '', name: '', arguments: '' };
                toolCallAccumulator.set(idx, acc);
              }
              if (tc.id) acc.id = tc.id;
              if (tc.function?.name) acc.name += tc.function.name;
              if (tc.function?.arguments) acc.arguments += tc.function.arguments;
            }
          }

          yield { content: delta?.content, tool_calls: delta?.tool_calls, finish_reason: finishReason };
        }
      }
    } finally {
      clearTimeout(timeout);
      try { reader.releaseLock(); } catch { /* */ }
    }

    // Assemble final tool_calls on the message
    if (toolCallAccumulator.size > 0) {
      finalMsg.tool_calls = Array.from(toolCallAccumulator.entries())
        .sort(([a], [b]) => a - b)
        .map(([, tc]) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.arguments },
        }));
    }

    return finalMsg;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const body = {
      model: config.llmModel,
      messages: req.messages,
      tools: req.tools,
      tool_choice: req.tools?.length ? 'auto' : undefined,
      temperature: req.temperature ?? 0.1,
      max_tokens: req.max_tokens ?? config.llmMaxTokens,
      stream: false,
    };

    // Large models (70B) can take 30-60s for a full response.
    // Allow up to 3 minutes before giving up.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);

    try {
      const res = await fetch(`${config.llmUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.llmApiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!res.ok) {
        const text = await res.text();
        logger.error('LLM request failed', { status: res.status, body: text.slice(0, 500) });
        throw new Error(`LLM error ${res.status}: ${text.slice(0, 200)}`);
      }

      return res.json() as Promise<ChatResponse>;
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('LLM request timed out after 180s. For 70B models, try reducing max_tokens or check GPU.');
      }
      throw err;
    }
  }

  /** Check if the LLM server is reachable AND the configured model is available. */
  async health(): Promise<{ ok: boolean; model?: string; error?: string; availableModels?: string[] }> {
    try {
      const res = await fetch(`${config.llmUrl}/models`, {
        headers: { 'Authorization': `Bearer ${config.llmApiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const data = await res.json() as { data?: Array<{ id: string }> };
      const available = (data.data || []).map(m => m.id);
      // Check the configured model is actually available
      const configured = config.llmModel;
      const hasConfigured = available.some(m => m === configured || m.startsWith(configured.split(':')[0] + ':'));
      if (!hasConfigured) {
        return {
          ok: false,
          error: `Configured model "${configured}" not found. Available: ${available.join(', ') || 'none'}`,
          model: configured,
          availableModels: available,
        };
      }
      return { ok: true, model: configured, availableModels: available };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'unknown' };
    }
  }
}
