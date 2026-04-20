/**
 * Approval Store — pending write tool calls that require admin approval.
 *
 * The agent creates an approval request; the admin clicks Approve in the UI;
 * then the tool is executed.
 */

import { v4 as uuidv4 } from 'uuid';

export interface ApprovalRequest {
  id: string;
  conversationId: string;
  userId: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed';
  createdAt: Date;
  decidedAt?: Date;
  decidedBy?: string;
  result?: unknown;
  error?: string;
}

export class ApprovalStore {
  private store = new Map<string, ApprovalRequest>();

  create(req: Omit<ApprovalRequest, 'id' | 'status' | 'createdAt'>): ApprovalRequest {
    const ap: ApprovalRequest = {
      ...req,
      id: uuidv4(),
      status: 'pending',
      createdAt: new Date(),
    };
    this.store.set(ap.id, ap);
    return ap;
  }

  get(id: string): ApprovalRequest | undefined {
    return this.store.get(id);
  }

  listPending(userId?: string): ApprovalRequest[] {
    return Array.from(this.store.values())
      .filter(a => a.status === 'pending' && (!userId || a.userId === userId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Atomically transition the approval from 'pending' to 'approved' or 'rejected'.
   * Throws if the approval doesn't exist or has already been decided.
   * Safe against concurrent calls: the first one wins, the second throws.
   */
  decide(id: string, decision: 'approved' | 'rejected', decidedBy: string): ApprovalRequest {
    const ap = this.store.get(id);
    if (!ap) throw new Error(`Approval not found: ${id}`);
    // Atomic compare-and-swap: in JS single-threaded runtime, these 3 ops run
    // atomically between I/O boundaries. No race possible within this function.
    if (ap.status !== 'pending') {
      throw new Error(`Approval already ${ap.status}${ap.decidedBy ? ` by ${ap.decidedBy}` : ''}`);
    }
    ap.status = decision;
    ap.decidedAt = new Date();
    ap.decidedBy = decidedBy;
    return ap;
  }

  markExecuted(id: string, result: unknown): void {
    const ap = this.store.get(id);
    if (!ap) return;
    ap.status = 'executed';
    ap.result = result;
  }

  markFailed(id: string, error: string): void {
    const ap = this.store.get(id);
    if (!ap) return;
    ap.status = 'failed';
    ap.error = error;
  }
}
