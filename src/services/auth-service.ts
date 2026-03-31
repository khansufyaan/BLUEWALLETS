import { v4 as uuidv4 } from 'uuid';
import { InMemoryUserStore } from '../stores/user-store';
import { logger } from '../utils/logger';

export interface Session {
  token: string;
  userId: string;
  username: string;
  displayName: string;
  role: string;
  createdAt: Date;
  expiresAt: Date;
}

const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

export class AuthService {
  private sessions = new Map<string, Session>();

  constructor(private userStore: InMemoryUserStore) {}

  async login(username: string, password: string): Promise<Session> {
    const user = await this.userStore.findByUsername(username);
    if (!user) throw new Error('Invalid username or password');

    const valid = await this.userStore.verifyPassword(user, password);
    if (!valid) throw new Error('Invalid username or password');

    // Invalidate any existing session for this user
    for (const [token, sess] of this.sessions) {
      if (sess.userId === user.id) this.sessions.delete(token);
    }

    const session: Session = {
      token: uuidv4(),
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    };

    this.sessions.set(session.token, session);
    logger.info('User logged in', { username: user.username, role: user.role });
    return session;
  }

  logout(token: string): void {
    const sess = this.sessions.get(token);
    if (sess) {
      this.sessions.delete(token);
      logger.info('User logged out', { username: sess.username });
    }
  }

  validate(token: string): Session | null {
    const sess = this.sessions.get(token);
    if (!sess) return null;
    if (new Date() > sess.expiresAt) {
      this.sessions.delete(token);
      return null;
    }
    return sess;
  }
}
