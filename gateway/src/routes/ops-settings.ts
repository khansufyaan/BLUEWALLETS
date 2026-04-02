/**
 * Settings Routes — API key management for all providers and RPC nodes.
 */

import { Router, Request, Response } from 'express';
import { complianceStore } from '../stores/compliance-store';
import { settingsStore } from '../stores/settings-store';
import { gasStore } from '../stores/gas-store';
import { logger } from '../utils/logger';

export function createOpsSettingsRoutes(): Router {
  const router = Router();

  /** GET /ops/settings — all settings (keys masked) */
  router.get('/', (_req: Request, res: Response) => {
    res.json({
      compliance:  complianceStore.getConfigMasked(),
      rpc:         settingsStore.getRpcSettingsMasked(),
      signer:      settingsStore.getSignerSettings(),
      gasStation:  gasStore.getConfig(),
    });
  });

  /** POST /ops/settings/compliance — update compliance API keys */
  router.post('/compliance', (req: Request, res: Response) => {
    try {
      complianceStore.setConfig(req.body);
      logger.info('Compliance settings updated via dashboard');
      res.json({ saved: true, config: complianceStore.getConfigMasked() });
    } catch (error) {
      res.status(400).json({ error: 'Invalid compliance config' });
    }
  });

  /** POST /ops/settings/rpc — update an RPC endpoint */
  router.post('/rpc', (req: Request, res: Response) => {
    const { chain, rpcUrl, provider } = req.body;
    if (!chain || !rpcUrl) {
      res.status(400).json({ error: 'chain and rpcUrl are required' });
      return;
    }
    try {
      settingsStore.setRpcUrl(chain, rpcUrl, provider);
      logger.info('RPC endpoint updated', { chain, provider: provider || 'auto' });
      res.json({ saved: true, settings: settingsStore.getRpcSettingsMasked() });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Failed' });
    }
  });

  /** POST /ops/settings/gas-station — update gas station config */
  router.post('/gas-station', (req: Request, res: Response) => {
    try {
      gasStore.setConfig(req.body);
      logger.info('Gas station settings updated via dashboard');
      res.json({ saved: true, config: gasStore.getConfig() });
    } catch (error) {
      res.status(400).json({ error: 'Invalid gas station config' });
    }
  });

  return router;
}
