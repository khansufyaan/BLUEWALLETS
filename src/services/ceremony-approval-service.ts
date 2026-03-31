import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

export interface CeremonyApproval {
  id: string;
  requestedById: string;       // user.id of the admin who initiated
  requestedByDisplay: string;  // display name for UI
  reason: string;
  requestedAt: Date;
  approvals: Array<{ userId: string; displayName: string; approvedAt: Date }>;
  status: 'pending' | 'approved' | 'expired' | 'used';
  expiresAt: Date;
}

const REQUIRED_APPROVALS = 2;
const EXPIRY_MS = 2 * 60 * 60 * 1000; // 2 hours

export class CeremonyApprovalService {
  private active: CeremonyApproval | null = null;

  /**
   * Cancel the current active approval request (admin restart).
   */
  cancel(): void {
    if (this.active && (this.active.status === 'pending' || this.active.status === 'approved')) {
      logger.info('Ceremony approval request cancelled', { id: this.active.id });
      this.active.status = 'expired';
    }
    this.active = null;
  }

  /**
   * Create a new approval request.
   * If a pending request exists, it blocks (must be explicitly cancelled).
   * If an approved-but-unused request exists, it is automatically superseded.
   */
  create(requestedById: string, requestedByDisplay: string, reason: string): CeremonyApproval {
    const existing = this.getActive();
    if (existing?.status === 'pending') {
      throw new Error('A pending approval request already exists. Ask an officer to cancel it before starting a new one.');
    }
    // Auto-supersede any approved-but-unused request (e.g. from a dry run)
    if (existing?.status === 'approved') {
      logger.info('Superseding unused approved request', { id: existing.id });
      existing.status = 'expired';
      this.active = null;
    }

    const now = new Date();
    const approval: CeremonyApproval = {
      id: uuidv4(),
      requestedById,
      requestedByDisplay: requestedByDisplay.trim(),
      reason: reason.trim(),
      requestedAt: now,
      approvals: [],
      status: 'pending',
      expiresAt: new Date(now.getTime() + EXPIRY_MS),
    };

    this.active = approval;
    logger.info('Ceremony approval request created', { id: approval.id, requestedByDisplay, reason });
    return approval;
  }

  /**
   * Add an approval to the request. Approver cannot be the requester or approve twice.
   * Sets status to 'approved' once REQUIRED_APPROVALS approvals are received.
   */
  approve(requestId: string, userId: string, displayName: string): CeremonyApproval {
    const approval = this.getActive();

    if (!approval) {
      throw new Error('No active approval request found.');
    }

    if (approval.id !== requestId) {
      throw new Error('Approval request ID does not match the active request.');
    }

    if (approval.status !== 'pending') {
      throw new Error(`Approval request is not pending (status: ${approval.status}).`);
    }

    if (userId === approval.requestedById) {
      throw new Error('The requester cannot approve their own ceremony request.');
    }

    const alreadyApproved = approval.approvals.some(a => a.userId === userId);
    if (alreadyApproved) {
      throw new Error(`${displayName} has already approved this request.`);
    }

    approval.approvals.push({ userId, displayName, approvedAt: new Date() });
    logger.info('Ceremony approval received', { id: requestId, approver: displayName, total: approval.approvals.length });

    if (approval.approvals.length >= REQUIRED_APPROVALS) {
      approval.status = 'approved';
      logger.info('Ceremony approval complete — required approvals reached', { id: requestId });
    }

    return approval;
  }

  /**
   * Returns the current active (pending or approved) request, auto-expiring stale ones.
   */
  getActive(): CeremonyApproval | null {
    if (!this.active) return null;

    if (this.active.status === 'pending' || this.active.status === 'approved') {
      if (new Date() > this.active.expiresAt) {
        this.active.status = 'expired';
        logger.info('Ceremony approval request expired', { id: this.active.id });
        return null;
      }
      return this.active;
    }

    return null;
  }

  /**
   * Demo-mode: force-approve the active request without requiring real officers.
   * Used only for single-operator investor demonstrations.
   */
  demoApprove(requestId: string): CeremonyApproval {
    const approval = this.getActive();
    if (!approval) throw new Error('No active approval request.');
    if (approval.id !== requestId) throw new Error('Request ID mismatch.');

    approval.approvals = [
      { userId: 'demo-officer-1', displayName: 'Demo Officer A', approvedAt: new Date() },
      { userId: 'demo-officer-2', displayName: 'Demo Officer B', approvedAt: new Date() },
    ];
    approval.status = 'approved';
    logger.info('Ceremony demo-approval granted (both officers simulated)', { id: requestId });
    return approval;
  }

  /**
   * Mark an approval as used (after the ceremony has completed).
   */
  markUsed(requestId: string): void {
    if (this.active && this.active.id === requestId) {
      this.active.status = 'used';
      logger.info('Ceremony approval marked as used', { id: requestId });
    }
  }
}
