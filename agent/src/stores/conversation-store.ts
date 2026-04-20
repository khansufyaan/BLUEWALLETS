/**
 * Conversation Store — keeps chat history per conversation ID.
 *
 * In-memory for POC with eviction policies to prevent unbounded growth.
 * Swap to Postgres for production.
 *
 * Eviction policy:
 *   - Max 1000 conversations total (LRU eviction on createst)
 *   - Max 200 messages per conversation (oldest trimmed on append)
 *   - Conversations idle > 24h auto-pruned on access
 */

import { ChatMessage } from '../services/llm-client';
import { v4 as uuidv4 } from 'uuid';

const MAX_CONVERSATIONS = 1000;
const MAX_MESSAGES_PER_CONVERSATION = 200;
const IDLE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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

  create(userId: string, title: string): Conversation {
    this.evictIfNeeded();
    const id = uuidv4();
    const now = new Date();
    const conv: Conversation = { id, userId, title, createdAt: now, updatedAt: now, messages: [] };
    this.store.set(id, conv);
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
      // Always keep the first user message (context) + drop the next-oldest
      const excess = conv.messages.length - MAX_MESSAGES_PER_CONVERSATION;
      conv.messages.splice(1, excess);
    }
    conv.updatedAt = new Date();
  }

  delete(id: string): void {
    this.store.delete(id);
  }

  /** Evict oldest conversations if we exceed the max. */
  private evictIfNeeded(): void {
    if (this.store.size < MAX_CONVERSATIONS) return;
    // Find oldest by updatedAt
    const sorted = Array.from(this.store.entries())
      .sort(([, a], [, b]) => a.updatedAt.getTime() - b.updatedAt.getTime());
    const toRemove = this.store.size - MAX_CONVERSATIONS + 1;
    for (let i = 0; i < toRemove; i++) {
      this.store.delete(sorted[i][0]);
    }
  }

  /** Prune conversations idle > IDLE_TTL_MS. Called lazily. */
  private pruneIdle(): void {
    const cutoff = Date.now() - IDLE_TTL_MS;
    for (const [id, conv] of this.store.entries()) {
      if (conv.updatedAt.getTime() < cutoff) this.store.delete(id);
    }
  }

  stats(): { total: number; totalMessages: number } {
    let totalMessages = 0;
    for (const c of this.store.values()) totalMessages += c.messages.length;
    return { total: this.store.size, totalMessages };
  }
}
