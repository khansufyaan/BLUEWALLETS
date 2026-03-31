export interface Vault {
  id: string;
  name: string;
  description: string;
  walletIds: string[];
  status: 'active' | 'archived';
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateVaultRequest {
  name: string;
  description?: string;
}
