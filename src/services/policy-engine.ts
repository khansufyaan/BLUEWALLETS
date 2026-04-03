import { v4 as uuidv4 } from 'uuid';
import { Policy, PolicyRule, PolicyEvaluation } from '../types/policy';
import { Wallet, Transaction, TransferRequest } from '../types/wallet';
import { IPolicyStore } from '../types/store';
import { logger } from '../utils/logger';

export class PolicyEngine {
  constructor(private store: IPolicyStore) {}

  // --- CRUD ---

  async createPolicy(data: { name: string; description?: string; rules: PolicyRule[] }): Promise<Policy> {
    const policy: Policy = {
      id: uuidv4(),
      name: data.name,
      description: data.description || '',
      rules: data.rules,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await this.store.create(policy);
    logger.info('Policy created', { policyId: policy.id, name: policy.name });
    return policy;
  }

  async getPolicy(id: string): Promise<Policy> {
    const policy = await this.store.findById(id);
    if (!policy) throw new Error(`Policy not found: ${id}`);
    return policy;
  }

  async listPolicies(): Promise<Policy[]> {
    return this.store.findAll();
  }

  async updatePolicy(id: string, data: Partial<Pick<Policy, 'name' | 'description' | 'rules' | 'enabled'>>): Promise<Policy> {
    await this.getPolicy(id); // throws if not found
    return this.store.update(id, data);
  }

  async deletePolicy(id: string): Promise<void> {
    await this.getPolicy(id);
    await this.store.delete(id);
    logger.info('Policy deleted', { policyId: id });
  }

  // --- Evaluation ---

  async evaluateTransfer(
    wallet: Wallet,
    transfer: TransferRequest,
    history: Transaction[]
  ): Promise<PolicyEvaluation[]> {
    if (wallet.policyIds.length === 0) return [];

    const policies = await this.store.findByIds(wallet.policyIds);
    const evaluations: PolicyEvaluation[] = [];

    for (const policy of policies) {
      if (!policy.enabled) continue;

      let passed = true;
      let failedRule: PolicyEvaluation['failedRule'];
      let reason: string | undefined;

      for (const rule of policy.rules) {
        const result = this.evaluateRule(rule, transfer, history);
        if (!result.passed) {
          passed = false;
          failedRule = rule.type;
          reason = result.reason;
          break; // first failing rule in this policy is enough
        }
      }

      evaluations.push({
        policyId: policy.id,
        policyName: policy.name,
        passed,
        failedRule,
        reason,
      });
    }

    const failed = evaluations.filter((e) => !e.passed);
    if (failed.length > 0) {
      logger.warn('Transfer blocked by policy', {
        walletId: wallet.id,
        failedPolicies: failed.map((e) => e.policyName),
      });
    }

    return evaluations;
  }

  // --- Rule evaluators ---

  private evaluateRule(
    rule: PolicyRule,
    transfer: TransferRequest,
    history: Transaction[]
  ): { passed: boolean; reason?: string } {
    switch (rule.type) {
      case 'spending_limit':
        return this.evalSpendingLimit(rule.params, transfer);
      case 'daily_limit':
        return this.evalDailyLimit(rule.params, transfer, history);
      case 'whitelist':
        return this.evalWhitelist(rule.params, transfer);
      case 'blacklist':
        return this.evalBlacklist(rule.params, transfer);
      case 'velocity':
        return this.evalVelocity(rule.params, transfer, history);
      case 'approval_threshold':
        return this.evalApprovalThreshold(rule.params, transfer);
      case 'time_window':
        return this.evalTimeWindow(rule.params);
      default:
        return { passed: true };
    }
  }

  private evalSpendingLimit(
    params: Record<string, unknown>,
    transfer: TransferRequest
  ): { passed: boolean; reason?: string } {
    const max = BigInt(params.maxAmount as string);
    const amount = BigInt(transfer.amount);
    if (amount > max) {
      return { passed: false, reason: `Amount ${transfer.amount} exceeds limit ${params.maxAmount}` };
    }
    return { passed: true };
  }

  private evalDailyLimit(
    params: Record<string, unknown>,
    transfer: TransferRequest,
    history: Transaction[]
  ): { passed: boolean; reason?: string } {
    const max = BigInt(params.maxDailyAmount as string);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dailySpent = history
      .filter((tx) => tx.status === 'completed' && tx.createdAt >= oneDayAgo)
      .reduce((sum, tx) => sum + tx.amount, 0n);
    const total = dailySpent + BigInt(transfer.amount);
    if (total > max) {
      return { passed: false, reason: `Daily total ${total} would exceed limit ${params.maxDailyAmount}` };
    }
    return { passed: true };
  }

  private evalWhitelist(
    params: Record<string, unknown>,
    transfer: TransferRequest
  ): { passed: boolean; reason?: string } {
    const allowed = params.walletIds as string[];
    if (!allowed.includes(transfer.toWalletId)) {
      return { passed: false, reason: `Destination ${transfer.toWalletId} not in whitelist` };
    }
    return { passed: true };
  }

  private evalBlacklist(
    params: Record<string, unknown>,
    transfer: TransferRequest
  ): { passed: boolean; reason?: string } {
    const blocked = params.walletIds as string[];
    if (blocked.includes(transfer.toWalletId)) {
      return { passed: false, reason: `Destination ${transfer.toWalletId} is blacklisted` };
    }
    return { passed: true };
  }

  private evalVelocity(
    params: Record<string, unknown>,
    transfer: TransferRequest,
    history: Transaction[]
  ): { passed: boolean; reason?: string } {
    const maxAmount = BigInt(params.maxAmount as string || '0');
    const windowMs = (params.windowMinutes as number) * 60 * 1000;
    const windowStart = new Date(Date.now() - windowMs);

    // Sum completed transfer amounts in the time window
    const spent = history
      .filter((tx) => tx.status === 'completed' && tx.createdAt >= windowStart)
      .reduce((sum, tx) => sum + tx.amount, BigInt(0));

    const newTotal = spent + BigInt(transfer.amount);

    if (newTotal > maxAmount) {
      return {
        passed: false,
        reason: `Window spend ${newTotal.toString()} + this transfer would exceed velocity limit ${maxAmount.toString()} in ${params.windowMinutes}min`,
      };
    }
    return { passed: true };
  }

  private evalApprovalThreshold(
    params: Record<string, unknown>,
    transfer: TransferRequest
  ): { passed: boolean; reason?: string } {
    const threshold = BigInt(params.threshold as string);
    const amount = BigInt(transfer.amount);
    if (amount > threshold) {
      return { passed: false, reason: `Amount ${transfer.amount} exceeds approval threshold ${params.threshold}` };
    }
    return { passed: true };
  }

  private evalTimeWindow(
    params: Record<string, unknown>
  ): { passed: boolean; reason?: string } {
    const start = params.allowedHoursStart as number;
    const end = params.allowedHoursEnd as number;
    const hour = new Date().getHours();
    const inWindow = start <= end ? hour >= start && hour < end : hour >= start || hour < end;
    if (!inWindow) {
      return { passed: false, reason: `Current hour ${hour} outside allowed window ${start}-${end}` };
    }
    return { passed: true };
  }
}
