import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { HsmConfigService } from '../services/hsm-config-service';
import { validate } from '../middleware/validate';
import { logger } from '../utils/logger';

const connectSchema = z.object({
  pkcs11Library: z.string().min(1, 'Library path is required'),
  slotIndex:     z.number().int().min(0).default(0),
  pin:           z.string().min(1, 'PIN is required'),
  label:         z.string().optional(),
});

export function createHsmConfigRoutes(hsmConfigService: HsmConfigService): Router {
  const router = Router();

  /** GET /api/v1/hsm/status — live connection status (no PIN returned) */
  router.get('/status', (_req: Request, res: Response) => {
    res.json(hsmConfigService.getStatus());
  });

  /** POST /api/v1/hsm/connect — connect with user-supplied params */
  router.post('/connect', validate(connectSchema), async (req: Request, res: Response) => {
    try {
      const params = req.body as z.infer<typeof connectSchema>;
      logger.info('HSM connect request', { library: params.pkcs11Library, slot: params.slotIndex });
      const status = await hsmConfigService.connect(params);
      res.json(status);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Connection failed';
      res.status(400).json({ error: msg });
    }
  });

  /** POST /api/v1/hsm/disconnect — graceful teardown */
  router.post('/disconnect', async (_req: Request, res: Response) => {
    try {
      await hsmConfigService.disconnect();
      res.json({ disconnected: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Disconnect failed';
      res.status(500).json({ error: msg });
    }
  });

  return router;
}
