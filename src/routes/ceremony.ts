import { Router, Request, Response } from 'express';
import { CeremonyService } from '../services/ceremony-service';
import { requireAuth } from '../middleware/auth';
import { AuthService } from '../services/auth-service';
import { logger } from '../utils/logger';

export function createCeremonyRoutes(
  ceremonyService: CeremonyService,
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

  /** POST /api/v1/ceremony/generate-keys — direct execution */
  router.post('/generate-keys', requireAuth(authService), async (req: Request, res: Response) => {
    try {
      logger.info('Key ceremony started', { user: req.session?.displayName });
      const result = await ceremonyService.generateMasterKeys();
      res.json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Key generation failed';
      logger.error('Key ceremony failed', { error: msg });
      res.status(500).json({ error: msg });
    }
  });

  /** POST /api/v1/ceremony/generate-hd-seed — generate BIP-39 mnemonic + master seed */
  router.post('/generate-hd-seed', requireAuth(authService), async (req: Request, res: Response) => {
    try {
      logger.info('HD ceremony started', { user: req.session?.displayName });
      const result = await ceremonyService.generateHdMasterSeed();
      res.json({
        mnemonic: result.mnemonic,
        mnemonicHash: result.mnemonicHash,
        masterSeedLabel: result.masterSeedLabel,
        warning: 'Save these 24 words now. They will NEVER be shown again.',
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'HD seed generation failed';
      logger.error('HD ceremony failed', { error: msg });
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
