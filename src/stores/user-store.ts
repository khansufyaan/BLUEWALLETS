import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

export interface WebAuthnCredential {
  credentialId:  string;    // base64url
  publicKey:     Uint8Array;
  counter:       number;
  transports?:   string[];  // 'usb' | 'ble' | 'nfc' | 'internal'
  createdAt:     Date;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  role: 'admin' | 'officer' | 'auditor';
  createdAt: Date;
  mustChangePassword: boolean;
  webauthnCredentials: WebAuthnCredential[];
}

export class InMemoryUserStore {
  private users = new Map<string, User>();

  async seed(): Promise<void> {
    const defaults: Array<Omit<User, 'id' | 'passwordHash' | 'createdAt' | 'webauthnCredentials'> & { password: string }> = [
      { username: 'admin',    displayName: 'System Administrator', role: 'admin',   password: 'Admin1234!',   mustChangePassword: false },
      { username: 'officer1', displayName: 'Officer 1',            role: 'officer', password: 'Officer1234!', mustChangePassword: true  },
      { username: 'officer2', displayName: 'Officer 2',            role: 'officer', password: 'Officer1234!', mustChangePassword: true  },
      { username: 'officer3', displayName: 'Officer 3',            role: 'officer', password: 'Officer1234!', mustChangePassword: true  },
      { username: 'auditor',  displayName: 'Auditor',              role: 'auditor', password: 'Auditor1234!', mustChangePassword: true  },
    ];

    for (const d of defaults) {
      const passwordHash = await bcrypt.hash(d.password, 12);
      const user: User = {
        id: uuidv4(),
        username: d.username,
        displayName: d.displayName,
        role: d.role,
        passwordHash,
        createdAt: new Date(),
        mustChangePassword: d.mustChangePassword,
        webauthnCredentials: [],
      };
      this.users.set(user.username, user);
      logger.info('Seeded user', { username: user.username, role: user.role });
    }
  }

  async listAll(): Promise<Omit<User, 'passwordHash' | 'webauthnCredentials'>[]> {
    return Array.from(this.users.values()).map(u => ({
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      role: u.role,
      createdAt: u.createdAt,
      mustChangePassword: u.mustChangePassword,
    }));
  }

  async createUser(data: { username: string; displayName: string; role: 'admin' | 'officer' | 'auditor'; password: string }): Promise<Omit<User, 'passwordHash' | 'webauthnCredentials'>> {
    if (this.users.has(data.username.toLowerCase())) {
      throw new Error(`User '${data.username}' already exists`);
    }
    const passwordHash = await bcrypt.hash(data.password, 12);
    const user: User = {
      id: uuidv4(),
      username: data.username.toLowerCase(),
      displayName: data.displayName,
      role: data.role,
      passwordHash,
      createdAt: new Date(),
      mustChangePassword: true,
      webauthnCredentials: [],
    };
    this.users.set(user.username, user);
    logger.info('Created user', { username: user.username, role: user.role });
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      createdAt: user.createdAt,
      mustChangePassword: user.mustChangePassword,
    };
  }

  async findByUsername(username: string): Promise<User | null> {
    return this.users.get(username.toLowerCase()) ?? null;
  }

  async findById(id: string): Promise<User | null> {
    for (const u of this.users.values()) {
      if (u.id === id) return u;
    }
    return null;
  }

  async verifyPassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.passwordHash);
  }

  // ── WebAuthn ──────────────────────────────────────────────────────────────

  async addWebAuthnCredential(userId: string, credential: WebAuthnCredential): Promise<void> {
    const user = await this.findById(userId);
    if (!user) throw new Error('User not found');
    user.webauthnCredentials.push(credential);
    logger.info('WebAuthn credential registered', {
      userId, credentialId: credential.credentialId.slice(0, 20) + '...',
    });
  }

  async findByCredentialId(credentialId: string): Promise<User | null> {
    for (const u of this.users.values()) {
      if (u.webauthnCredentials.some(c => c.credentialId === credentialId)) {
        return u;
      }
    }
    return null;
  }

  async updateCredentialCounter(userId: string, credentialId: string, newCounter: number): Promise<void> {
    const user = await this.findById(userId);
    if (!user) return;
    const cred = user.webauthnCredentials.find(c => c.credentialId === credentialId);
    if (cred) cred.counter = newCounter;
  }

  hasWebAuthnCredentials(username: string): boolean {
    const user = this.users.get(username.toLowerCase());
    return !!(user && user.webauthnCredentials.length > 0);
  }

  getWebAuthnCredentials(username: string): WebAuthnCredential[] {
    const user = this.users.get(username.toLowerCase());
    return user?.webauthnCredentials || [];
  }
}
