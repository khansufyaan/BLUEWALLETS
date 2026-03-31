import { Policy } from '../types/policy';
import { IPolicyStore } from '../types/store';

export class InMemoryPolicyStore implements IPolicyStore {
  private policies = new Map<string, Policy>();

  async create(policy: Policy): Promise<Policy> {
    this.policies.set(policy.id, policy);
    return policy;
  }

  async findById(id: string): Promise<Policy | null> {
    return this.policies.get(id) || null;
  }

  async findAll(): Promise<Policy[]> {
    return Array.from(this.policies.values());
  }

  async findByIds(ids: string[]): Promise<Policy[]> {
    return ids
      .map((id) => this.policies.get(id))
      .filter((p): p is Policy => p !== undefined);
  }

  async update(id: string, partial: Partial<Policy>): Promise<Policy> {
    const existing = this.policies.get(id);
    if (!existing) throw new Error(`Policy not found: ${id}`);
    const updated = { ...existing, ...partial, updatedAt: new Date() };
    this.policies.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.policies.delete(id);
  }
}
