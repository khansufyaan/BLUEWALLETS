/**
 * Blue Agent — Configuration
 */

export const config = {
  port: parseInt(process.env.AGENT_PORT || '3500', 10),

  // LLM server (OpenAI-compatible endpoint — Ollama, vLLM, LM Studio, etc.)
  llmUrl:       process.env.LLM_URL       || 'http://localhost:11434/v1',
  llmModel:     process.env.LLM_MODEL     || 'qwen2.5:7b-instruct',
  llmApiKey:    process.env.LLM_API_KEY   || 'ollama', // Ollama ignores but OpenAI-compat requires
  llmMaxTokens: parseInt(process.env.LLM_MAX_TOKENS || '2048', 10),

  // Embeddings server (for future RAG — optional)
  embedUrl:   process.env.EMBED_URL   || '',
  embedModel: process.env.EMBED_MODEL || 'bge-large-en-v1.5',

  // Gateway/Driver URLs — the agent calls these to execute tools
  gatewayUrl: process.env.GATEWAY_URL || 'http://localhost:3400',
  driverUrl:  process.env.DRIVER_URL  || 'http://localhost:3100',

  // Internal auth for Driver API calls (when agent performs writes)
  internalAuthKey: process.env.INTERNAL_AUTH_KEY || '',

  // Agent auth — callers must provide this header
  agentAuthKey: process.env.AGENT_AUTH_KEY || '',

  // Feature flags
  allowWriteTools: (process.env.ALLOW_WRITE_TOOLS || 'true') === 'true',
  requireApproval: (process.env.REQUIRE_APPROVAL || 'true') === 'true',

  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
};
