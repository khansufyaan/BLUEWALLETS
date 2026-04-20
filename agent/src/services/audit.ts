/**
 * Audit Logger — records every agent interaction for compliance.
 *
 * Every prompt, tool call, approval decision, and response is logged
 * with full context. Production: ship to Driver's audit_log table.
 */

import { logger } from '../logger';
import { v4 as uuidv4 } from 'uuid';

export interface AuditEntry {
  id: string;
  timestamp: Date;
  userId: string;
  conversationId: string;
  event: 'prompt' | 'llm_response' | 'tool_call' | 'approval_requested' | 'approval_decided' | 'tool_executed';
  data: Record<string, unknown>;
}

class AuditService {
  private entries: AuditEntry[] = [];

  record(entry: Omit<AuditEntry, 'id' | 'timestamp'>): void {
    const full: AuditEntry = { ...entry, id: uuidv4(), timestamp: new Date() };
    this.entries.push(full);
    logger.info('AUDIT', { event: full.event, userId: full.userId, conversationId: full.conversationId });
    // Keep last 10k entries in memory; production should ship to Driver
    if (this.entries.length > 10000) this.entries.shift();
  }

  list(limit = 100): AuditEntry[] {
    return this.entries.slice(-limit).reverse();
  }

  listForConversation(conversationId: string): AuditEntry[] {
    return this.entries.filter(e => e.conversationId === conversationId);
  }
}

export const audit = new AuditService();
