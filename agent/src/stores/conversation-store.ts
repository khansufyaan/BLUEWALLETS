/**
 * Conversation Store — keeps chat history per conversation ID.
 *
 * In-memory for POC. Swap to Postgres for production.
 */

import { ChatMessage } from '../services/llm-client';
import { v4 as uuidv4 } from 'uuid';

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
    const id = uuidv4();
    const now = new Date();
    const conv: Conversation = { id, userId, title, createdAt: now, updatedAt: now, messages: [] };
    this.store.set(id, conv);
    return conv;
  }

  get(id: string): Conversation | undefined {
    return this.store.get(id);
  }

  listByUser(userId: string): Conversation[] {
    return Array.from(this.store.values())
      .filter(c => c.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  append(id: string, message: ChatMessage): void {
    const conv = this.store.get(id);
    if (!conv) throw new Error(`Conversation not found: ${id}`);
    conv.messages.push(message);
    conv.updatedAt = new Date();
  }

  delete(id: string): void {
    this.store.delete(id);
  }
}
