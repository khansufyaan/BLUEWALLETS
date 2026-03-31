import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { KmsService } from '../services/kms-service';
import { validate } from '../middleware/validate';
import { KeyAlgorithm } from '../types';
import { logger } from '../utils/logger';

const VALID_ALGORITHMS: KeyAlgorithm[] = [
  'EC_P256', 'EC_P384', 'EC_SECP256K1', 'RSA_2048', 'RSA_4096', 'ED25519',
];

const generateKeySchema = z.object({
  algorithm: z.enum(VALID_ALGORITHMS as [string, ...string[]]),
  label: z.string().min(1).max(128).optional(),
});

const signSchema = z.object({
  data: z.string().min(1), // hex-encoded data to sign
});

const verifySchema = z.object({
  data: z.string().min(1),      // hex-encoded
  signature: z.string().min(1), // hex-encoded
});

export function createKeyRoutes(kms: KmsService): Router {
  const router = Router();

  // POST /keys — Generate a new key pair
  router.post('/', validate(generateKeySchema), async (req: Request, res: Response) => {
    try {
      const { algorithm, label } = req.body;
      const result = await kms.generateKeyPair(algorithm as KeyAlgorithm, label);
      res.status(201).json({
        keyId: result.keyId,
        algorithm: result.algorithm,
        publicKey: result.publicKey.toString('hex'),
        createdAt: result.createdAt.toISOString(),
      });
    } catch (error) {
      logger.error('Key generation failed', { error });
      res.status(500).json({ error: 'Key generation failed' });
    }
  });

  // GET /keys — List all keys
  router.get('/', async (_req: Request, res: Response) => {
    try {
      const keys = await kms.listKeys();
      res.json({
        keys: keys.map((k) => ({
          keyId: k.keyId,
          algorithm: k.algorithm,
          publicKey: k.publicKey.toString('hex'),
          label: k.label,
        })),
        count: keys.length,
      });
    } catch (error) {
      logger.error('Failed to list keys', { error });
      res.status(500).json({ error: 'Failed to list keys' });
    }
  });

  // POST /keys/:keyId/sign — Sign data
  router.post('/:keyId/sign', validate(signSchema), async (req: Request, res: Response) => {
    try {
      const { keyId } = req.params;
      const data = Buffer.from(req.body.data, 'hex');
      const result = await kms.sign(keyId, data);
      res.json({
        signature: result.signature.toString('hex'),
        keyId: result.keyId,
        algorithm: result.algorithm,
        mechanism: result.mechanism,
      });
    } catch (error) {
      logger.error('Signing failed', { error, keyId: req.params.keyId });
      const message = error instanceof Error ? error.message : 'Signing failed';
      const status = message.includes('not found') ? 404 : 500;
      res.status(status).json({ error: message });
    }
  });

  // POST /keys/:keyId/verify — Verify a signature
  router.post('/:keyId/verify', validate(verifySchema), async (req: Request, res: Response) => {
    try {
      const { keyId } = req.params;
      const data = Buffer.from(req.body.data, 'hex');
      const signature = Buffer.from(req.body.signature, 'hex');
      const result = await kms.verify(keyId, data, signature);
      res.json(result);
    } catch (error) {
      logger.error('Verification failed', { error, keyId: req.params.keyId });
      const message = error instanceof Error ? error.message : 'Verification failed';
      const status = message.includes('not found') ? 404 : 500;
      res.status(status).json({ error: message });
    }
  });

  // DELETE /keys/:keyId — Delete a key pair
  router.delete('/:keyId', async (req: Request, res: Response) => {
    try {
      const { keyId } = req.params;
      await kms.deleteKeyPair(keyId);
      res.json({ deleted: true, keyId });
    } catch (error) {
      logger.error('Key deletion failed', { error, keyId: req.params.keyId });
      res.status(500).json({ error: 'Key deletion failed' });
    }
  });

  return router;
}
