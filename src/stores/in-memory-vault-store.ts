import { Vault } from '../types/vault';
import { IVaultStore } from '../types/store';

export class InMemoryVaultStore implements IVaultStore {
  private vaults = new Map<string, Vault>();

  async create(vault: Vault): Promise<Vault> {
    this.vaults.set(vault.id, vault);
    return vault;
  }

  async findById(id: string): Promise<Vault | null> {
    return this.vaults.get(id) || null;
  }

  async findAll(): Promise<Vault[]> {
    return Array.from(this.vaults.values());
  }

  async update(id: string, partial: Partial<Vault>): Promise<Vault> {
    const existing = this.vaults.get(id);
    if (!existing) throw new Error(`Vault not found: ${id}`);
    const updated = { ...existing, ...partial, updatedAt: new Date() };
    this.vaults.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.vaults.delete(id);
  }
}
