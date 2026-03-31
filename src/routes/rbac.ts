import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { RbacService } from '../services/rbac-service';
import { validate } from '../middleware/validate';
import { ALL_PERMISSIONS } from '../types/rbac';
import { logger } from '../utils/logger';

const createRoleSchema = z.object({
  name: z.string().min(1).max(128),
  description: z.string().max(512).optional(),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).min(1),
});

const updateRoleSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(512).optional(),
  permissions: z.array(z.enum(ALL_PERMISSIONS as [string, ...string[]])).min(1).optional(),
  status: z.enum(['active', 'archived']).optional(),
});

export function createRbacRoutes(rbacService: RbacService): Router {
  const router = Router();

  // --- Roles ---
  router.post('/roles', validate(createRoleSchema), async (req: Request, res: Response) => {
    try {
      const role = await rbacService.createRole(req.body);
      res.status(201).json(role);
    } catch (error) {
      logger.error('Role creation failed', { error });
      const msg = error instanceof Error ? error.message : 'Role creation failed';
      res.status(400).json({ error: msg });
    }
  });

  router.get('/roles', async (_req: Request, res: Response) => {
    try {
      const roles = await rbacService.listRoles();
      res.json({ roles, count: roles.length });
    } catch (error) {
      res.status(500).json({ error: 'Failed to list roles' });
    }
  });

  router.get('/roles/:id', async (req: Request, res: Response) => {
    try {
      const role = await rbacService.getRole(req.params.id);
      res.json(role);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed';
      res.status(msg.includes('not found') ? 404 : 500).json({ error: msg });
    }
  });

  router.put('/roles/:id', validate(updateRoleSchema), async (req: Request, res: Response) => {
    try {
      const role = await rbacService.updateRole(req.params.id, req.body);
      res.json(role);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed';
      const status = msg.includes('not found') ? 404 : msg.includes('managed') ? 403 : 500;
      res.status(status).json({ error: msg });
    }
  });

  router.delete('/roles/:id', async (req: Request, res: Response) => {
    try {
      await rbacService.deleteRole(req.params.id);
      res.json({ deleted: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed';
      const status = msg.includes('not found') ? 404 : msg.includes('managed') ? 403 : 500;
      res.status(status).json({ error: msg });
    }
  });

  // --- Permissions reference ---
  router.get('/permissions', async (_req: Request, res: Response) => {
    const { PERMISSION_GROUPS } = await import('../types/rbac');
    res.json({ permissions: ALL_PERMISSIONS, groups: PERMISSION_GROUPS });
  });

  return router;
}
