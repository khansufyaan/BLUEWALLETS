/**
 * Approval Routes — Maker/Checker for HSM operations.
 *
 * Operators view pending actions, approve/reject them.
 * Approval triggers automatic execution of the action.
 */

import { Router, Request, Response } from 'express';
import { ApprovalService, PendingActionType } from '../services/approval-service';
import { AuthService } from '../services/auth-service';
import { requireAuth } from '../middleware/auth';
import { logger } from '../utils/logger';

type Executor = (payload: any) => Promise<any>;

export function createApprovalRoutes(
  approvalService: ApprovalService,
  authService: AuthService,
  executors: Record<PendingActionType, Executor>,
): Router {
  const router = Router();

  /** GET /api/v1/approvals/pending — list all pending actions */
  router.get('/pending', requireAuth(authService), (_req: Request, res: Response) => {
    res.json({ actions: approvalService.getPending() });
  });

  /** GET /api/v1/approvals/history — full audit trail */
  router.get('/history', requireAuth(authService), (req: Request, res: Response) => {
    // Bounded limit to prevent DoS via huge pagination values
    const raw = parseInt(String(req.query.limit || ''), 10);
    const limit = Number.isFinite(raw) ? Math.max(1, Math.min(raw, 1000)) : 50;
    res.json({ actions: approvalService.getHistory(limit) });
  });

  /** GET /api/v1/approvals/:id — single action details */
  router.get('/:id', requireAuth(authService), (req: Request, res: Response) => {
    const action = approvalService.getById(req.params.id);
    if (!action) { res.status(404).json({ error: 'Action not found' }); return; }
    res.json(action);
  });

  /**
   * POST /api/v1/approvals/:id/approve
   *
   * Approves the action and immediately executes it.
   * Self-approval is blocked by the ApprovalService.
   */
  router.post('/:id/approve', requireAuth(authService), async (req: Request, res: Response) => {
    try {
      // Step 1: Approve (validates different user, not expired, etc.)
      const action = approvalService.approve(req.params.id, {
        userId:      req.session!.userId,
        username:    req.session!.username,
        displayName: req.session!.displayName,
      });

      // Step 2: Execute the approved action
      const executor = executors[action.actionType];
      if (!executor) {
        approvalService.markExecuted(action.id, null, 'No executor found for action type');
        res.status(500).json({ error: 'No executor configured for this action type' });
        return;
      }

      try {
        // Get the raw (unsanitized) action for the actual payload
        const rawAction = approvalService.getById(action.id);
        const result = await executor(rawAction?.payload || action.payload);
        approvalService.markExecuted(action.id, result);

        logger.info('Approved action executed successfully', {
          actionId: action.id,
          type: action.actionType,
          approver: req.session!.displayName,
        });

        res.json({
          action: approvalService.getById(action.id),
          result,
          message: `${action.description} — executed successfully`,
        });
      } catch (execError) {
        const msg = execError instanceof Error ? execError.message : 'Execution failed';
        approvalService.markExecuted(action.id, null, msg);
        logger.error('Approved action execution failed', {
          actionId: action.id,
          error: msg,
        });
        res.status(500).json({
          action: approvalService.getById(action.id),
          error: msg,
        });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Approval failed';
      res.status(400).json({ error: msg });
    }
  });

  /** POST /api/v1/approvals/:id/reject */
  router.post('/:id/reject', requireAuth(authService), (req: Request, res: Response) => {
    try {
      const action = approvalService.reject(req.params.id, {
        userId:      req.session!.userId,
        username:    req.session!.username,
        displayName: req.session!.displayName,
      }, req.body?.reason);

      res.json({ action, message: 'Action rejected' });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Rejection failed';
      res.status(400).json({ error: msg });
    }
  });

  /** POST /api/v1/approvals/:id/cancel — initiator cancels their own action */
  router.post('/:id/cancel', requireAuth(authService), (req: Request, res: Response) => {
    try {
      approvalService.cancel(req.params.id, { userId: req.session!.userId });
      res.json({ cancelled: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Cancel failed';
      res.status(400).json({ error: msg });
    }
  });

  return router;
}
