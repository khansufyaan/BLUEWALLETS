/**
 * Compliance Screening Middleware
 *
 * Intercepts all POST /api/v1/transfers and screens the destination address
 * against configured compliance providers (Chainalysis, TRM, Notabene).
 *
 * If ANY provider returns a sanctions hit or risk above threshold → 403 BLOCKED.
 * All decisions (pass or block) are recorded for audit.
 */

import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { complianceStore } from '../stores/compliance-store';
import { screenWithChainalysis } from '../services/compliance/chainalysis-client';
import { screenWithTrm } from '../services/compliance/trm-client';
import { checkTravelRule } from '../services/compliance/notabene-client';
import { ScreeningResult, ComplianceDecision } from '../types/compliance';
import { logger } from '../utils/logger';

export async function complianceScreen(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { toAddress, chain, walletId, amount } = req.body || {};

  // Only screen if we have an address and at least one provider is configured
  if (!toAddress || !complianceStore.isAnyProviderEnabled()) {
    if (!complianceStore.isAnyProviderEnabled()) {
      logger.debug('No compliance providers configured — skipping screening');
    }
    next();
    return;
  }

  const resolvedChain = (chain || 'ethereum').toLowerCase();

  logger.info('Compliance screening started', { address: toAddress, chain: resolvedChain });

  try {
    // Run all configured providers in parallel
    const results: ScreeningResult[] = [];
    const screeningPromises: Promise<ScreeningResult | null>[] = [
      screenWithChainalysis(toAddress, resolvedChain),
      screenWithTrm(toAddress, resolvedChain),
      checkTravelRule(toAddress, resolvedChain, 10000), // assume > threshold for now
    ];

    const settled = await Promise.allSettled(screeningPromises);
    settled.forEach(s => {
      if (s.status === 'fulfilled' && s.value) {
        results.push(s.value);
      }
    });

    // Evaluate results
    const config = complianceStore.getConfig();
    let blocked = false;
    let blockedBy: string | undefined;
    let reason: string | undefined;

    for (const result of results) {
      // Hard block: any sanctions hit
      if (result.sanctioned) {
        blocked = true;
        blockedBy = result.provider;
        reason = `Sanctions hit detected by ${result.provider}: ${result.categories.join(', ')}`;
        break;
      }

      // Soft block: risk score above threshold (Chainalysis)
      if (result.provider === 'chainalysis' && result.riskScore !== null) {
        if (result.riskScore >= config.chainalysis.riskThreshold) {
          blocked = true;
          blockedBy = 'chainalysis';
          reason = `Risk score ${result.riskScore}/10 exceeds threshold ${config.chainalysis.riskThreshold}`;
          break;
        }
      }

      // Notabene rejection
      if (result.provider === 'notabene' && result.riskLevel === 'critical') {
        blocked = true;
        blockedBy = 'notabene';
        reason = result.alerts[0] || 'Travel Rule check failed';
        break;
      }
    }

    // Record decision
    const decision: ComplianceDecision = {
      id:        uuidv4(),
      address:   toAddress,
      chain:     resolvedChain,
      walletId:  walletId || '',
      direction: 'outbound',
      allowed:   !blocked,
      results,
      blockedBy,
      reason,
      timestamp: new Date().toISOString(),
    };

    complianceStore.addDecision(decision);

    if (blocked) {
      logger.warn('Transfer BLOCKED by compliance', {
        address: toAddress, chain: resolvedChain, blockedBy, reason,
      });

      res.status(403).json({
        error:     'Transfer blocked by compliance screening',
        blockedBy,
        reason,
        decisionId: decision.id,
        results:    results.map(r => ({
          provider:   r.provider,
          riskScore:  r.riskScore,
          riskLevel:  r.riskLevel,
          sanctioned: r.sanctioned,
          categories: r.categories,
        })),
      });
      return;
    }

    logger.info('Compliance screening passed', {
      address: toAddress, chain: resolvedChain,
      providers: results.map(r => `${r.provider}:${r.riskLevel}`).join(', '),
    });

    // Attach decision to request for downstream use
    (req as any).complianceDecision = decision;
    next();
  } catch (error) {
    logger.error('Compliance screening error', {
      error: error instanceof Error ? error.message : error,
      address: toAddress,
    });
    // On screening failure, block by default (fail-closed)
    res.status(500).json({
      error: 'Compliance screening failed — transfer blocked (fail-closed)',
    });
  }
}
