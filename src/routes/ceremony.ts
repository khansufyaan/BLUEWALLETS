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

export function createCeremonyRoutes(
  ceremonyService: CeremonyService,
  approvalService: CeremonyApprovalService,
  authService: AuthService,
): Router {
  const router = Router();

  /** GET /api/v1/ceremony/status */
  router.get('/status', requireAuth(authService), (_req: Request, res: Response) => {
    try {
      res.json(ceremonyService.getStatus());
    } catch (error) {
      logger.error('Failed to get ceremony status', { error });
      res.status(500).json({ error: 'Failed to get ceremony status' });
    }
  });

  /** POST /api/v1/ceremony/cancel */
  router.post('/cancel', requireAuth(authService), (_req: Request, res: Response) => {
    try {
      approvalService.cancel();
      res.json({ cancelled: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to cancel';
      res.status(500).json({ error: msg });
    }
  });

  /** POST /api/v1/ceremony/initiate */
  router.post('/initiate', requireAuth(authService), validate(initiateSchema), (req: Request, res: Response) => {
    try {
      const { reason } = req.body as { reason: string };
      const approval = approvalService.create(
        req.session!.userId,
        req.session!.displayName,
        reason,
      );
      logger.info('Ceremony initiated', { by: req.session!.displayName, reason });
      res.json(approval);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to initiate ceremony';
      logger.error('Ceremony initiation failed', { error });
      res.status(400).json({ error: msg });
    }
  });

  /** POST /api/v1/ceremony/approve — officer approves the active request */
  router.post('/approve', requireAuth(authService), requireRole('officer', 'admin'), validate(approveSchema), (req: Request, res: Response) => {
    try {
      const { requestId } = req.body as { requestId: string };
      const approval = approvalService.approve(
        requestId,
        req.session!.userId,
        req.session!.displayName,
      );
      logger.info('Ceremony approved', { requestId, by: req.session!.displayName });
      res.json(approval);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Approval failed';
      logger.error('Ceremony approval failed', { error });
      res.status(400).json({ error: msg });
    }
  });

  /** GET /api/v1/ceremony/approval */
  router.get('/approval', requireAuth(authService), (_req: Request, res: Response) => {
    try {
      res.json(approvalService.getActive());
    } catch (error) {
      res.status(500).json({ error: 'Failed to get approval status' });
    }
  });

  /** POST /api/v1/ceremony/demo-approve — bypass quorum for testing */
  router.post('/demo-approve', requireAuth(authService), (req: Request, res: Response) => {
    try {
      const { requestId } = req.body as { requestId: string };
      if (!requestId) { res.status(400).json({ error: 'requestId is required' }); return; }
      const approval = approvalService.demoApprove(requestId);
      logger.info('Ceremony demo-approved', { requestId });
      res.json(approval);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Demo approval failed';
      res.status(400).json({ error: msg });
    }
  });

  /**
   * POST /api/v1/ceremony/generate-keys
   *
   * THE core ceremony step — replaces entropy/shares/reconstruct.
   *
   * Generates blue:wrap:v1 (AES-256) inside the Luna HSM via C_GenerateKey.
   *   CKA_SENSITIVE=true, CKA_EXTRACTABLE=false  — never exits HSM in plaintext
   *   CKA_WRAP=true, CKA_UNWRAP=true             — wraps/unwraps wallet EC private keys
   *
   * Every wallet created after this point has its EC private key wrapped with this
   * key and stored as AES-256 ciphertext in the database. The private key only
   * re-enters the HSM session briefly during C_Sign, then is destroyed.
   *
   * FIPS 140-3 Level 3 compliant.
   * Requires an approved ceremony request.
   */
  router.post('/generate-keys', requireAuth(authService), async (_req: Request, res: Response) => {
    try {
      logger.info('Ceremony: generating master wrap key on HSM');
      const result = await ceremonyService.generateMasterKeys();
      res.json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Key generation failed';
      logger.error('Master key generation failed', { error });
      res.status(500).json({ error: msg });
    }
  });

  /** POST /api/v1/ceremony/complete */
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
