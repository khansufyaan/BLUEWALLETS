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

export class LlmClient {
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

    const res = await fetch(`${config.llmUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.llmApiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      logger.error('LLM request failed', { status: res.status, body: text });
      throw new Error(`LLM error ${res.status}: ${text.slice(0, 200)}`);
    }

    return res.json() as Promise<ChatResponse>;
  }

  /** Check if the LLM server is reachable. */
  async health(): Promise<{ ok: boolean; model?: string; error?: string }> {
    try {
      const res = await fetch(`${config.llmUrl}/models`, {
        headers: { 'Authorization': `Bearer ${config.llmApiKey}` },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const data = await res.json() as { data?: Array<{ id: string }> };
      return { ok: true, model: data.data?.[0]?.id || config.llmModel };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'unknown' };
    }
  }
}
