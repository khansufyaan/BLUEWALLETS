import { v4 as uuidv4 } from 'uuid';
import { Vault, CreateVaultRequest } from '../types/vault';
import { IVaultStore } from '../types/store';
import { logger } from '../utils/logger';

export class VaultService {
  constructor(private store: IVaultStore) {}

  async createVault(req: CreateVaultRequest): Promise<Vault> {
    const vault: Vault = {
      id: uuidv4(),
      name: req.name,
      description: req.description || '',
      walletIds: [],
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await this.store.create(vault);
    logger.info('Vault created', { vaultId: vault.id, name: vault.name });
    return vault;
  }

  async getVault(id: string): Promise<Vault> {
    const vault = await this.store.findById(id);
    if (!vault) throw new Error(`Vault not found: ${id}`);
    return vault;
  }

  async listVaults(): Promise<Vault[]> {
    return this.store.findAll();
  }

  async updateVault(id: string, data: Partial<Pick<Vault, 'name' | 'description' | 'status'>>): Promise<Vault> {
    await this.getVault(id);
    return this.store.update(id, data);
  }

  async addWalletToVault(vaultId: string, walletId: string): Promise<Vault> {
    const vault = await this.getVault(vaultId);
    if (!vault.walletIds.includes(walletId)) {
      return this.store.update(vaultId, {
        walletIds: [...vault.walletIds, walletId],
      });
    }
    return vault;
  }

  async removeWalletFromVault(vaultId: string, walletId: string): Promise<Vault> {
    const vault = await this.getVault(vaultId);
    return this.store.update(vaultId, {
      walletIds: vault.walletIds.filter(id => id !== walletId),
    });
  }
}
