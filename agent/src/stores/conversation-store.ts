/**
 * Conversation Store — keeps chat history per conversation ID.
 *
 * - In-memory for speed
 * - File-backed persistence so conversations survive container restarts
 * - Eviction policies to prevent unbounded growth
 *
 * Eviction policy:
 *   - Max 1000 conversations total (LRU eviction on create)
 *   - Max 200 messages per conversation (oldest trimmed on append)
 *   - Conversations idle > 24h auto-pruned on access
 *
 * Persistence:
 *   - Set CONVERSATION_DATA_DIR env var to a writable directory
 *     (default: /data/conversations). Each conversation is stored as
 *     <id>.json. Writes are debounced (250ms) per conversation.
 *   - Loads all conversations on startup (sync).
 */

import fs from 'fs';
import path from 'path';
import { ChatMessage } from '../services/llm-client';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../logger';

const MAX_CONVERSATIONS = 1000;
const MAX_MESSAGES_PER_CONVERSATION = 200;
const IDLE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const PERSIST_DEBOUNCE_MS = 250;

export interface Conversation {
  id: string;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  title: string;
  messages: ChatMessage[];
}

export class InMemoryConversationStore {
  private store = new Map<string, Conversation>();
  private pendingWrites = new Map<string, NodeJS.Timeout>();
  private persistDir: string | null = null;

  constructor(persistDir?: string) {
    const dir = persistDir ?? process.env.CONVERSATION_DATA_DIR ?? '/data/conversations';
    this.initPersistence(dir);
  }

  private initPersistence(dir: string): void {
    try {
      fs.mkdirSync(dir, { recursive: true });
      // Write-access probe
      fs.accessSync(dir, fs.constants.W_OK);
      this.persistDir = dir;
      this.loadFromDisk();
      logger.info('Conversation persistence enabled', { dir, loaded: this.store.size });
    } catch (err) {
      logger.warn('Conversation persistence unavailable — using in-memory only', {
        dir,
        error: err instanceof Error ? err.message : err,
      });
      this.persistDir = null;
    }
  }

  private loadFromDisk(): void {
    if (!this.persistDir) return;
    try {
      const files = fs.readdirSync(this.persistDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const raw = fs.readFileSync(path.join(this.persistDir, file), 'utf-8');
          const conv = JSON.parse(raw);
          // Rehydrate Date objects (JSON.parse returns strings)
          conv.createdAt = new Date(conv.createdAt);
          conv.updatedAt = new Date(conv.updatedAt);
          this.store.set(conv.id, conv);
        } catch (err) {
          logger.warn('Failed to load conversation file', { file, error: err instanceof Error ? err.message : err });
        }
      }
    } catch (err) {
      logger.warn('Failed to scan persistence dir', { error: err instanceof Error ? err.message : err });
    }
  }

  private schedulePersist(id: string): void {
    if (!this.persistDir) return;
    // Debounce: coalesce rapid appends into a single write
    const existing = this.pendingWrites.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.pendingWrites.delete(id);
      this.persistNow(id);
    }, PERSIST_DEBOUNCE_MS);
    this.pendingWrites.set(id, timer);
  }

  private persistNow(id: string): void {
    if (!this.persistDir) return;
    const conv = this.store.get(id);
    if (!conv) {
      // Conversation was deleted — remove file if present
      try {
        fs.unlinkSync(path.join(this.persistDir, `${id}.json`));
      } catch { /* ignore */ }
      return;
    }
    try {
      const tmpFile = path.join(this.persistDir, `${id}.json.tmp`);
      const finalFile = path.join(this.persistDir, `${id}.json`);
      // Atomic write: write to temp file then rename
      fs.writeFileSync(tmpFile, JSON.stringify(conv));
      fs.renameSync(tmpFile, finalFile);
    } catch (err) {
      logger.warn('Failed to persist conversation', {
        id, error: err instanceof Error ? err.message : err,
      });
    }
  }

  create(userId: string, title: string): Conversation {
    this.evictIfNeeded();
    const id = uuidv4();
    const now = new Date();
    const conv: Conversation = { id, userId, title, createdAt: now, updatedAt: now, messages: [] };
    this.store.set(id, conv);
    this.schedulePersist(id);
    return conv;
  }

  get(id: string): Conversation | undefined {
    this.pruneIdle();
    return this.store.get(id);
  }

  listByUser(userId: string): Conversation[] {
    this.pruneIdle();
    return Array.from(this.store.values())
      .filter(c => c.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  append(id: string, message: ChatMessage): void {
    const conv = this.store.get(id);
    if (!conv) throw new Error(`Conversation not found: ${id}`);
    conv.messages.push(message);
    // Trim oldest messages if over the cap
    if (conv.messages.length > MAX_MESSAGES_PER_CONVERSATION) {
      const excess = conv.messages.length - MAX_MESSAGES_PER_CONVERSATION;
      conv.messages.splice(1, excess);
    }
    conv.updatedAt = new Date();
    this.schedulePersist(id);
  }

  /** Update part of the last message in a conversation (for streaming). */
  updateLastMessage(id: string, updater: (msg: ChatMessage) => ChatMessage): void {
    const conv = this.store.get(id);
    if (!conv || conv.messages.length === 0) return;
    conv.messages[conv.messages.length - 1] = updater(conv.messages[conv.messages.length - 1]);
    conv.updatedAt = new Date();
    this.schedulePersist(id);
  }

  updateTitle(id: string, title: string): void {
    const conv = this.store.get(id);
    if (!conv) return;
    conv.title = title;
    conv.updatedAt = new Date();
    this.schedulePersist(id);
  }

  delete(id: string): void {
    this.store.delete(id);
    this.pendingWrites.delete(id);
    if (this.persistDir) {
      try { fs.unlinkSync(path.join(this.persistDir, `${id}.json`)); } catch { /* ignore */ }
    }
  }

  /** Evict oldest conversations if we exceed the max. */
  private evictIfNeeded(): void {
    if (this.store.size < MAX_CONVERSATIONS) return;
    const sorted = Array.from(this.store.entries())
      .sort(([, a], [, b]) => a.updatedAt.getTime() - b.updatedAt.getTime());
    const toRemove = this.store.size - MAX_CONVERSATIONS + 1;
    for (let i = 0; i < toRemove; i++) {
      this.delete(sorted[i][0]);
    }
  }

  /** Prune conversations idle > IDLE_TTL_MS. Called lazily. */
  private pruneIdle(): void {
    const cutoff = Date.now() - IDLE_TTL_MS;
    for (const [id, conv] of this.store.entries()) {
      if (conv.updatedAt.getTime() < cutoff) this.delete(id);
    }
  }

  stats(): { total: number; totalMessages: number; persisted: boolean } {
    let totalMessages = 0;
    for (const c of this.store.values()) totalMessages += c.messages.length;
    return { total: this.store.size, totalMessages, persisted: this.persistDir !== null };
  }
}
