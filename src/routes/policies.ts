import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { PolicyEngine } from '../services/policy-engine';
import { validate } from '../middleware/validate';
import { logger } from '../utils/logger';

const RULE_TYPES = [
  'spending_limit', 'daily_limit', 'whitelist', 'blacklist',
  'velocity', 'approval_threshold', 'time_window',
] as const;

const createPolicySchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(512).optional(),
  rules: z.array(z.object({
    type: z.enum(RULE_TYPES),
    params: z.record(z.unknown()),
  })).min(1),
});

const updatePolicySchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(512).optional(),
  rules: z.array(z.object({
    type: z.enum(RULE_TYPES),
    params: z.record(z.unknown()),
  })).min(1).optional(),
  enabled: z.boolean().optional(),
});

export function createPolicyRoutes(policyEngine: PolicyEngine): Router {
  const router = Router();

  router.post('/', validate(createPolicySchema), async (req: Request, res: Response) => {
    try {
      const policy = await policyEngine.createPolicy(req.body);
      res.status(201).json(policy);
    } catch (error) {
      logger.error('Policy creation failed', { error });
      res.status(500).json({ error: 'Policy creation failed' });
    }
  });

  router.get('/', async (_req: Request, res: Response) => {
    try {
      const policies = await policyEngine.listPolicies();
      res.json({ policies, count: policies.length });
    } catch (error) {
      logger.error('Failed to list policies', { error });
      res.status(500).json({ error: 'Failed to list policies' });
    }
  });

  router.get('/:id', async (req: Request, res: Response) => {
    try {
      const policy = await policyEngine.getPolicy(req.params.id);
      res.json(policy);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed';
      res.status(msg.includes('not found') ? 404 : 500).json({ error: msg });
    }
  });

  router.put('/:id', validate(updatePolicySchema), async (req: Request, res: Response) => {
    try {
      const policy = await policyEngine.updatePolicy(req.params.id, req.body);
      res.json(policy);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed';
      res.status(msg.includes('not found') ? 404 : 500).json({ error: msg });
    }
  });

  router.delete('/:id', async (req: Request, res: Response) => {
    try {
      await policyEngine.deletePolicy(req.params.id);
      res.json({ deleted: true, policyId: req.params.id });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed';
      res.status(msg.includes('not found') ? 404 : 500).json({ error: msg });
    }
  });

  return router;
}
