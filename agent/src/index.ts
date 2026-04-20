/**
 * Blue Agent — HTTP API server.
 *
 * Endpoints:
 *   GET  /health                          — service health + LLM reachability
 *   POST /agent/conversations             — start a new conversation
 *   GET  /agent/conversations             — list my conversations
 *   GET  /agent/conversations/:id         — get conversation with messages
 *   POST /agent/conversations/:id/chat    — send a message, get response
 *   DELETE /agent/conversations/:id       — delete a conversation
 *   GET  /agent/approvals                 — list pending approvals
 *   POST /agent/approvals/:id/decide      — approve or reject
 *   GET  /agent/tools                     — list available tools (introspection)
 *   GET  /agent/audit                     — recent audit entries
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { z } from 'zod';
import { config } from './config';
import { logger } from './logger';
import { LlmClient } from './services/llm-client';
import { InMemoryConversationStore } from './stores/conversation-store';
import { ApprovalStore } from './stores/approval-store';
import { Agent } from './services/agent';
import { audit } from './services/audit';
import { getAvailableTools, registerTools } from './tools/registry';
import { ADVANCED_TOOLS, createRagSearchTool } from './tools/advanced-tools';
import { EmbeddingsClient } from './services/rag/embeddings';
import { KnowledgeStore } from './services/rag/knowledge-store';
import { KnowledgeIndexer } from './services/rag/indexer';
import { WhisperClient } from './services/whisper';

async function main() {
  const llm = new LlmClient();
  const conversations = new InMemoryConversationStore();
  const approvals = new ApprovalStore();
  const agent = new Agent(llm, conversations, approvals);

  // ── RAG setup ────────────────────────────────────────────────────────────
  const embeddings = new EmbeddingsClient();
  const knowledge = new KnowledgeStore(embeddings);
  const indexer = new KnowledgeIndexer(knowledge);

  // Register advanced tools + RAG search tool
  registerTools([...ADVANCED_TOOLS, createRagSearchTool(knowledge)]);

  // Start indexer (non-blocking)
  embeddings.health().then(h => {
    if (h.ok) {
      logger.info('Embeddings model reachable — starting knowledge indexer');
      indexer.start();
    } else {
      logger.warn('Embeddings unavailable — RAG disabled. Pull nomic-embed-text to enable.', { error: h.error });
    }
  });

  // ── Whisper (voice) ──────────────────────────────────────────────────────
  const whisper = new WhisperClient();
  whisper.health().then(h => {
    if (h.ok) logger.info('Whisper STT reachable');
    else logger.info('Whisper not configured — voice input disabled (optional)');
  });

  // LLM reachability check (non-blocking)
  llm.health().then(h => {
    if (h.ok) logger.info('LLM reachable', { model: h.model, url: config.llmUrl });
    else logger.warn('LLM not reachable — chat will fail until available', { url: config.llmUrl, error: h.error });
  });

  const app = express();
  app.use(helmet());
  app.use(cors({ origin: process.env.CORS_ORIGIN || false, credentials: true }));
  app.use(express.json({ limit: '512kb' }));

  // Simple auth — require AGENT_AUTH_KEY header on all /agent/* routes
  const requireAuth = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!config.agentAuthKey) {
      // Dev mode — allow through
      (req as any).userId = 'dev-user';
      (req as any).userToken = req.headers.authorization?.replace('Bearer ', '');
      return next();
    }
    const provided = req.headers['x-agent-key'] as string | undefined;
    if (!provided || provided !== config.agentAuthKey) {
      res.status(401).json({ error: 'Missing or invalid X-Agent-Key header' });
      return;
    }
    (req as any).userId = (req.headers['x-user-id'] as string) || 'unknown';
    (req as any).userToken = req.headers.authorization?.replace('Bearer ', '');
    next();
  };

  // Health
  app.get('/health', async (_req, res) => {
    const llmHealth = await llm.health();
    res.json({
      service: 'blue-agent',
      status: llmHealth.ok ? 'healthy' : 'degraded',
      llm: llmHealth,
      tools: getAvailableTools().length,
    });
  });

  const router = express.Router();
  router.use(requireAuth);

  // List conversations
  router.get('/conversations', (req, res) => {
    const userId = (req as any).userId as string;
    const list = conversations.listByUser(userId).map(c => ({
      id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt,
      messageCount: c.messages.length,
    }));
    res.json({ conversations: list });
  });

  // Create conversation
  const createSchema = z.object({ title: z.string().min(1).max(200).optional() });
  router.post('/conversations', (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid body' });
    const userId = (req as any).userId as string;
    const title = parsed.data.title || 'New conversation';
    const conv = conversations.create(userId, title);
    res.json({ id: conv.id, title: conv.title, createdAt: conv.createdAt });
  });

  // Get conversation
  router.get('/conversations/:id', (req, res) => {
    const conv = conversations.get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    const userId = (req as any).userId as string;
    if (conv.userId !== userId) return res.status(403).json({ error: 'Forbidden' });
    res.json({
      id: conv.id, title: conv.title, createdAt: conv.createdAt, updatedAt: conv.updatedAt,
      messages: conv.messages,
    });
  });

  // Delete conversation
  router.delete('/conversations/:id', (req, res) => {
    const conv = conversations.get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    const userId = (req as any).userId as string;
    if (conv.userId !== userId) return res.status(403).json({ error: 'Forbidden' });
    conversations.delete(req.params.id);
    res.json({ ok: true });
  });

  // Streaming chat (SSE) — emits tokens as they arrive from the LLM
  const chatStreamSchema = z.object({ message: z.string().min(1).max(10000) });
  router.post('/conversations/:id/chat/stream', async (req, res) => {
    const parsed = chatStreamSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid body' });

    const conv = conversations.get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    const userId = (req as any).userId as string;
    if (conv.userId !== userId) return res.status(403).json({ error: 'Forbidden' });

    // Set up SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
    // Flush headers immediately
    (res as any).flushHeaders?.();

    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const userToken = (req as any).userToken as string | undefined;
      await agent.chatStreaming({
        conversationId: req.params.id,
        userId,
        userMessage: parsed.data.message,
        userToken,
        onEvent: send,
      });
      send('done', {});
      res.end();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Stream chat failed', { error: msg });
      send('error', { error: msg });
      res.end();
    }
  });

  // Non-streaming chat (kept for back-compat)
  const chatSchema = z.object({ message: z.string().min(1).max(10000) });
  router.post('/conversations/:id/chat', async (req, res) => {
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid body' });

    const conv = conversations.get(req.params.id);
    if (!conv) return res.status(404).json({ error: 'Not found' });
    const userId = (req as any).userId as string;
    if (conv.userId !== userId) return res.status(403).json({ error: 'Forbidden' });

    try {
      const result = await agent.chat(
        req.params.id, userId, parsed.data.message,
        (req as any).userToken,
      );
      const approvalData = result.pendingApprovals.map(id => approvals.get(id)).filter(Boolean);
      res.json({
        messages: result.messages,
        pendingApprovals: approvalData,
        done: result.done,
      });
    } catch (err) {
      logger.error('Chat failed', { error: err instanceof Error ? err.message : err });
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // List pending approvals
  router.get('/approvals', (req, res) => {
    const userId = (req as any).userId as string;
    const list = approvals.listPending(userId);
    res.json({ approvals: list });
  });

  // Decide on approval
  const decideSchema = z.object({ decision: z.enum(['approved', 'rejected']) });
  router.post('/approvals/:id/decide', async (req, res) => {
    const parsed = decideSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid body' });

    const approval = approvals.get(req.params.id);
    if (!approval) return res.status(404).json({ error: 'Not found' });
    const userId = (req as any).userId as string;

    try {
      approvals.decide(req.params.id, parsed.data.decision, userId);
      audit.record({
        userId, conversationId: approval.conversationId,
        event: 'approval_decided',
        data: { approvalId: req.params.id, decision: parsed.data.decision },
      });

      // Resume the conversation
      const result = await agent.resumeAfterApproval(req.params.id, (req as any).userToken);
      res.json({ approval: approvals.get(req.params.id), messages: result.messages });
    } catch (err) {
      logger.error('Approval decide failed', { error: err instanceof Error ? err.message : err });
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // List tools (for introspection)
  router.get('/tools', (_req, res) => {
    const tools = getAvailableTools().map(t => ({
      name: t.name, kind: t.kind, description: t.description,
      parameters: t.parameters,
    }));
    res.json({ tools });
  });

  // Recent audit
  router.get('/audit', (req, res) => {
    const limit = Math.min(parseInt(String(req.query.limit || '100'), 10), 500);
    res.json({ entries: audit.list(limit) });
  });

  // ── Voice transcription (Whisper STT) ──────────────────────────────────
  // Accepts multipart/form-data with an audio file or raw audio blob.
  router.post('/voice/transcribe', express.raw({ type: '*/*', limit: '25mb' }), async (req, res) => {
    try {
      const health = await whisper.health();
      if (!health.ok) {
        return res.status(503).json({ error: 'Whisper service unavailable', detail: health.error });
      }
      const audioBuffer = req.body as Buffer;
      if (!audioBuffer || !audioBuffer.length) {
        return res.status(400).json({ error: 'No audio data' });
      }
      const result = await whisper.transcribe(audioBuffer, 'audio.webm');
      res.json(result);
    } catch (err) {
      logger.error('Transcribe failed', { error: err instanceof Error ? err.message : err });
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // ── Knowledge base (RAG) ───────────────────────────────────────────────
  router.get('/knowledge/stats', (_req, res) => {
    res.json(knowledge.stats());
  });

  router.post('/knowledge/reindex', async (_req, res) => {
    try {
      const result = await indexer.runOnce();
      res.json({ ok: true, added: result.added, stats: knowledge.stats() });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  app.use('/agent', router);

  app.listen(config.port, () => {
    logger.info(`Blue Agent running on port ${config.port}`, {
      llm: config.llmUrl,
      model: config.llmModel,
      gateway: config.gatewayUrl,
      writeTools: config.allowWriteTools,
      requireApproval: config.requireApproval,
    });
  });
}

main().catch((err) => {
  logger.error('Fatal error', { error: err instanceof Error ? err.message : err });
  process.exit(1);
});
