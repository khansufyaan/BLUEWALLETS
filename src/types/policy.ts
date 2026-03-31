export type PolicyRuleType =
  | 'spending_limit'
  | 'daily_limit'
  | 'whitelist'
  | 'blacklist'
  | 'velocity'
  | 'approval_threshold'
  | 'time_window';

export interface PolicyRule {
  type: PolicyRuleType;
  params: Record<string, unknown>;
}

export interface Policy {
  id: string;
  name: string;
  description: string;
  rules: PolicyRule[];
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PolicyEvaluation {
  policyId: string;
  policyName: string;
  passed: boolean;
  failedRule?: PolicyRuleType;
  reason?: string;
}
