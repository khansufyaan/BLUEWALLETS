/**
 * Maker/Checker Approval Service for Blue Driver.
 *
 * Any sensitive HSM operation requires dual approval:
 *   1. Operator A initiates → action goes to PENDING
 *   2. Operator B (different person) approves → action executes
 *
 * Self-approval is blocked. Pending actions expire after 15 minutes.
 * Full audit trail is maintained.
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

export type PendingActionType = 'hsm-connect' | 'key-ceremony' | 'pin-change';

export interface PendingAction {
  id:                      string;
  actionType:              PendingActionType;
  description:             string;       // human-readable description of what will happen

  // Initiator
  initiatorId:             string;
  initiatorUsername:        string;
  initiatorDisplayName:    string;

  // Payload (action-specific data needed to execute)
  payload:                 Record<string, any>;

  // Status
  status:                  'pending' | 'approved' | 'executed' | 'rejected' | 'expired' | 'failed';
  createdAt:               Date;
  expiresAt:               Date;

  // Approver (filled when approved)
  approverId?:             string;
  approverUsername?:        string;
  approverDisplayName?:    string;
  approvedAt?:             Date;

  // Execution result (filled after execution)
  executedAt?:             Date;
  executionResult?:        any;
  executionError?:         string;

  // Rejection
  rejectedBy?:             string;
  rejectionReason?:        string;
  rejectedAt?:             Date;
}

const ACTION_DESCRIPTIONS: Record<PendingActionType, string> = {
  'hsm-connect':  'Connect to Luna HSM via PKCS#11',
  'key-ceremony': 'Generate master wrap key (blue:wrap:v1) on HSM',
  'pin-change':   'Change HSM partition PIN',
};

const EXPIRY_MS = 15 * 60 * 1000; // 15 minutes

export class ApprovalService {
  private actions = new Map<string, PendingAction>();

  /**
   * Initiate a new action requiring approval.
   * Returns the pending action for the UI to display.
   */
  initiate(
    actionType: PendingActionType,
    session: { userId: string; username: string; displayName: string },
    payload: Record<string, any> = {},
  ): PendingAction {
    // Check for existing pending action of same type
    this.cleanExpired();
    const existing = this.getPendingByType(actionType);
    if (existing) {
      throw new Error(`A pending ${actionType} action already exists (ID: ${existing.id}). Cancel it first or wait for it to expire.`);
    }

    const now = new Date();
    const action: PendingAction = {
      id:                   uuidv4(),
      actionType,
      description:          ACTION_DESCRIPTIONS[actionType] || actionType,
      initiatorId:          session.userId,
      initiatorUsername:     session.username,
      initiatorDisplayName: session.displayName,
      payload,
      status:               'pending',
      createdAt:            now,
      expiresAt:            new Date(now.getTime() + EXPIRY_MS),
    };

    this.actions.set(action.id, action);
    logger.info('Action initiated (awaiting approval)', {
      actionId: action.id,
      type: actionType,
      initiator: session.displayName,
    });

    return this.sanitize(action);
  }

  /**
   * Approve a pending action. Approver must be a different person than the initiator.
   */
  approve(
    actionId: string,
    session: { userId: string; username: string; displayName: string },
  ): PendingAction {
    this.cleanExpired();
    const action = this.actions.get(actionId);

    if (!action) throw new Error('Action not found');
    if (action.status !== 'pending') throw new Error(`Action is not pending (status: ${action.status})`);
    if (new Date() > action.expiresAt) {
      action.status = 'expired';
      throw new Error('Action has expired. Initiate a new one.');
    }

    // CRITICAL: Self-approval blocked
    if (session.userId === action.initiatorId) {
      throw new Error('You cannot approve your own action. A different operator must approve.');
    }

    action.status              = 'approved';
    action.approverId          = session.userId;
    action.approverUsername     = session.username;
    action.approverDisplayName = session.displayName;
    action.approvedAt          = new Date();

    logger.info('Action approved', {
      actionId: action.id,
      type: action.actionType,
      initiator: action.initiatorDisplayName,
      approver: session.displayName,
    });

    return this.sanitize(action);
  }

  /**
   * Reject a pending action.
   */
  reject(
    actionId: string,
    session: { userId: string; username: string; displayName: string },
    reason?: string,
  ): PendingAction {
    const action = this.actions.get(actionId);
    if (!action) throw new Error('Action not found');
    if (action.status !== 'pending') throw new Error(`Action is not pending (status: ${action.status})`);

    action.status          = 'rejected';
    action.rejectedBy      = session.displayName;
    action.rejectionReason = reason || 'Rejected by operator';
    action.rejectedAt      = new Date();

    logger.info('Action rejected', {
      actionId: action.id,
      type: action.actionType,
      rejectedBy: session.displayName,
      reason,
    });

    return this.sanitize(action);
  }

  /**
   * Mark an action as executed (called after the actual operation runs).
   */
  markExecuted(actionId: string, result?: any, error?: string): void {
    const action = this.actions.get(actionId);
    if (!action) return;

    if (error) {
      action.status         = 'failed';
      action.executionError = error;
    } else {
      action.status          = 'executed';
      action.executionResult = result;
    }
    action.executedAt = new Date();

    logger.info('Action execution recorded', {
      actionId: action.id,
      type: action.actionType,
      status: action.status,
      error: error || undefined,
    });
  }

  /**
   * Get a single action by ID.
   */
  getById(actionId: string): PendingAction | null {
    this.cleanExpired();
    const action = this.actions.get(actionId);
    return action ? this.sanitize(action) : null;
  }

  /**
   * Get all pending (non-expired) actions.
   */
  getPending(): PendingAction[] {
    this.cleanExpired();
    return [...this.actions.values()]
      .filter(a => a.status === 'pending')
      .map(a => this.sanitize(a));
  }

  /**
   * Get pending action by type (only one per type allowed).
   */
  getPendingByType(actionType: PendingActionType): PendingAction | null {
    this.cleanExpired();
    const found = [...this.actions.values()].find(
      a => a.actionType === actionType && a.status === 'pending'
    );
    return found ? this.sanitize(found) : null;
  }

  /**
   * Get full audit history.
   */
  getHistory(limit = 50): PendingAction[] {
    return [...this.actions.values()]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map(a => this.sanitize(a));
  }

  /**
   * Cancel a pending action (only the initiator can cancel).
   */
  cancel(actionId: string, session: { userId: string }): void {
    const action = this.actions.get(actionId);
    if (!action) throw new Error('Action not found');
    if (action.status !== 'pending') throw new Error('Can only cancel pending actions');
    action.status = 'expired';
    logger.info('Action cancelled', { actionId, by: session.userId });
  }

  /**
   * Auto-expire stale pending actions.
   */
  cleanExpired(): void {
    const now = new Date();
    for (const action of this.actions.values()) {
      if (action.status === 'pending' && now > action.expiresAt) {
        action.status = 'expired';
        logger.info('Action expired', { actionId: action.id, type: action.actionType });
      }
    }
  }

  /**
   * Sanitize action for API response (strip sensitive payload data like PINs).
   */
  private sanitize(action: PendingAction): PendingAction {
    const safe = { ...action };
    // Strip sensitive fields from payload
    if (safe.payload) {
      const p = { ...safe.payload };
      if (p.pin) p.pin = '****';
      if (p.currentPin) p.currentPin = '****';
      if (p.newPin) p.newPin = '****';
      safe.payload = p;
    }
    return safe;
  }
}
