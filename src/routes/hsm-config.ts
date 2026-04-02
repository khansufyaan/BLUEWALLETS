import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { HsmConfigService } from '../services/hsm-config-service';
import { validate } from '../middleware/validate';
import { logger } from '../utils/logger';

const changePinSchema = z.object({
  currentPin: z.string().min(1, 'Current PIN is required'),
  newPin:     z.string().min(4, 'New PIN must be at least 4 characters'),
});

const connectSchema = z.object({
  pkcs11Library: z.string().min(1, 'Library path is required'),
  slotIndex:     z.number().int().min(0).default(0),
  pin:           z.string().min(1, 'PIN is required'),
  label:         z.string().optional(),
});

export function createHsmConfigRoutes(
  hsmConfigService: HsmConfigService,
): Router {
  const router = Router();

  /** GET /api/v1/hsm/status */
  router.get('/status', (_req: Request, res: Response) => {
    res.json(hsmConfigService.getStatus());
  });

  /** POST /api/v1/hsm/connect — direct execution, no approval needed */
  router.post('/connect', validate(connectSchema), async (req: Request, res: Response) => {
    try {
      const params = req.body as z.infer<typeof connectSchema>;
      logger.info('HSM connect requested', {
        library: params.pkcs11Library,
        slot: params.slotIndex,
        user: req.session?.displayName,
      });

      const result = await hsmConfigService.connect(params);
      res.json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'HSM connection failed';
      logger.error('HSM connect failed', { error: msg });
      res.status(500).json({ error: msg });
    }
  });

  /** POST /api/v1/hsm/change-pin — direct execution */
  router.post('/change-pin', validate(changePinSchema), async (req: Request, res: Response) => {
    try {
      const { currentPin, newPin } = req.body as z.infer<typeof changePinSchema>;
      logger.info('HSM PIN change requested', { user: req.session?.displayName });

      const result = await hsmConfigService.changePin(currentPin, newPin);
      res.json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'PIN change failed';
      logger.error('HSM PIN change failed', { error: msg });
      res.status(500).json({ error: msg });
    }
  });

  /** POST /api/v1/hsm/disconnect */
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
