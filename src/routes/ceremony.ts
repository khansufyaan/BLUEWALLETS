import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { CeremonyService } from '../services/ceremony-service';
import { CeremonyApprovalService } from '../services/ceremony-approval-service';
import { validate } from '../middleware/validate';
import { requireAuth, requireRole } from '../middleware/auth';
import { AuthService } from '../services/auth-service';
import { logger } from '../utils/logger';

const initiateSchema = z.object({
  reason: z.string().min(1, 'reason is required'),
});

const approveSchema = z.object({
  requestId: z.string().min(1, 'requestId is required'),
});

const completeSchema = z.object({
  coinTypes: z.array(z.string()).min(1, 'Select at least one coin type'),
});

const reconstructSchema = z.object({
  shares: z.array(z.string()).min(3, 'At least 3 shares are required'),
});

export function createCeremonyRoutes(
  ceremonyService: CeremonyService,
  approvalService: CeremonyApprovalService,
  authService: AuthService,
): Router {
  const router = Router();

  /**
   * POST /api/v1/ceremony/cancel
   * Cancel the active approval request (admin restart / dry-run cleanup).
   */
  router.post('/cancel', requireAuth(authService), (_req: Request, res: Response) => {
    try {
      approvalService.cancel();
      res.json({ cancelled: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to cancel';
      res.status(500).json({ error: msg });
    }
  });

  /**
   * GET /api/v1/ceremony/status
   * Returns whether the HSM key ceremony has been completed.
   */
  router.get('/status', requireAuth(authService), (_req: Request, res: Response) => {
    try {
      const status = ceremonyService.getStatus();
      res.json(status);
    } catch (error) {
      logger.error('Failed to get ceremony status', { error });
      res.status(500).json({ error: 'Failed to get ceremony status' });
    }
  });

  /**
   * POST /api/v1/ceremony/initiate
   * Start a ceremony approval request. Identity comes from the authenticated session.
   * Body: { reason: string }
   */
  router.post('/initiate', requireAuth(authService), validate(initiateSchema), (req: Request, res: Response) => {
    try {
      const { reason } = req.body as { reason: string };
      const requestedById = req.session!.userId;
      const requestedByDisplay = req.session!.displayName;
      logger.info('Ceremony: initiate request', { requestedByDisplay, reason });
      const approval = approvalService.create(requestedById, requestedByDisplay, reason);
      res.json(approval);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to initiate ceremony';
      logger.error('Ceremony initiation failed', { error });
      res.status(400).json({ error: msg });
    }
  });

  /**
   * POST /api/v1/ceremony/approve
   * An officer approves the active ceremony request.
   * The officer must be authenticated; identity comes from session.
   * Body: { requestId: string }
   */
  router.post('/approve', requireAuth(authService), requireRole('officer', 'admin'), validate(approveSchema), (req: Request, res: Response) => {
    try {
      const { requestId } = req.body as { requestId: string };
      const userId = req.session!.userId;
      const displayName = req.session!.displayName;
      logger.info('Ceremony: approval submitted', { requestId, displayName });
      const approval = approvalService.approve(requestId, userId, displayName);
      res.json(approval);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Approval failed';
      logger.error('Ceremony approval failed', { error });
      res.status(400).json({ error: msg });
    }
  });

  /**
   * GET /api/v1/ceremony/approval
   * Returns the current active approval request (pending or approved).
   */
  router.get('/approval', requireAuth(authService), (_req: Request, res: Response) => {
    try {
      const approval = approvalService.getActive();
      res.json(approval);
    } catch (error) {
      logger.error('Failed to get approval status', { error });
      res.status(500).json({ error: 'Failed to get approval status' });
    }
  });

  /**
   * POST /api/v1/ceremony/entropy
   * Generate 256-bit entropy from HSM C_GenerateRandom and split into 5 Shamir shares.
   * Requires an approved ceremony request.
   */
  router.post('/entropy', requireAuth(authService), async (_req: Request, res: Response) => {
    try {
      logger.info('Ceremony: generating entropy from HSM');
      const result = await ceremonyService.generateEntropy();
      res.json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Entropy generation failed';
      logger.error('Entropy generation failed', { error });
      res.status(500).json({ error: msg });
    }
  });

  /**
   * GET /api/v1/ceremony/shares/:index
   * Retrieve a single Shamir share by index (0-based).
   * Returns: { shareHex: string, index: number, total: 5 }
   */
  router.get('/shares/:index', requireAuth(authService), (req: Request, res: Response) => {
    try {
      const index = parseInt(req.params.index, 10);
      if (isNaN(index)) {
        res.status(400).json({ error: 'Invalid share index' });
        return;
      }
      const shareHex = ceremonyService.getShare(index);
      res.json({ shareHex, index, total: 5 });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to get share';
      logger.error('Get share failed', { error });
      res.status(400).json({ error: msg });
    }
  });

  /**
   * POST /api/v1/ceremony/shares/:index/acknowledge
   * Mark a Shamir share as acknowledged by its custodian.
   */
  router.post('/shares/:index/acknowledge', requireAuth(authService), (req: Request, res: Response) => {
    try {
      const index = parseInt(req.params.index, 10);
      if (isNaN(index)) {
        res.status(400).json({ error: 'Invalid share index' });
        return;
      }
      ceremonyService.acknowledgeShare(index);
      res.json({ acknowledged: true, index });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to acknowledge share';
      logger.error('Acknowledge share failed', { error });
      res.status(400).json({ error: msg });
    }
  });

  /**
   * POST /api/v1/ceremony/reconstruct
   * Reconstruct the master key from 3+ Shamir shares and seal into HSM.
   * Body: { shares: string[] } (array of hex-encoded share strings)
   */
  router.post('/reconstruct', requireAuth(authService), validate(reconstructSchema), async (req: Request, res: Response) => {
    try {
      const { shares } = req.body as { shares: string[] };
      logger.info('Ceremony: reconstructing master key from shares', { shareCount: shares.length });
      const result = await ceremonyService.reconstructAndSeal(shares);
      res.json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Reconstruction failed';
      logger.error('Reconstruct and seal failed', { error });
      res.status(500).json({ error: msg });
    }
  });

  /**
   * POST /api/v1/ceremony/complete
   * Finalise ceremony with selected coin types.
   * Body: { coinTypes: string[] }
   */
  router.post('/complete', requireAuth(authService), validate(completeSchema), (req: Request, res: Response) => {
    try {
      const { coinTypes } = req.body as { coinTypes: string[] };
      const state = ceremonyService.completeCeremony(coinTypes);
      res.json(state);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to complete ceremony';
      logger.error('Ceremony completion failed', { error });
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
