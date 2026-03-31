import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

export interface User {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  role: 'admin' | 'officer' | 'auditor';
  createdAt: Date;
  mustChangePassword: boolean;
}

export class InMemoryUserStore {
  private users = new Map<string, User>();

  async seed(): Promise<void> {
    const defaults: Array<Omit<User, 'id' | 'passwordHash' | 'createdAt'> & { password: string }> = [
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
      };
      this.users.set(user.username, user);
      logger.info('Seeded user', { username: user.username, role: user.role });
    }
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
}
