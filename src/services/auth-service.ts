import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { InMemoryUserStore, User } from '../stores/user-store';
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
const CHALLENGE_TTL_MS = 5 * 60 * 1000;    // 5 minutes

// Relying Party config — derived from request in route handlers
const RP_NAME = 'Blue Driver';

export class AuthService {
  private sessions = new Map<string, Session>();
  private challenges = new Map<string, { challenge: string; userId?: string; expiresAt: Date }>();

  constructor(private userStore: InMemoryUserStore) {}

  // ── Password Auth ─────────────────────────────────────────────────────────

  async login(username: string, password: string): Promise<Session> {
    const user = await this.userStore.findByUsername(username);
    if (!user) throw new Error('Invalid username or password');

    const valid = await this.userStore.verifyPassword(user, password);
    if (!valid) throw new Error('Invalid username or password');

    return this.createSession(user);
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

  // ── WebAuthn Registration ─────────────────────────────────────────────────

  async webauthnRegisterOptions(userId: string, rpId: string): Promise<any> {
    const user = await this.userStore.findById(userId);
    if (!user) throw new Error('User not found');

    const existingCreds = this.userStore.getWebAuthnCredentials(user.username);

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: rpId,
      userName: user.username,
      userDisplayName: user.displayName,
      attestationType: 'none',
      excludeCredentials: existingCreds.map(c => ({
        id: c.credentialId,
        transports: (c.transports || []) as any[],
      })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    // Store challenge for verification
    this.challenges.set(user.username, {
      challenge: options.challenge,
      userId: user.id,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    });

    return options;
  }

  async webauthnRegisterVerify(
    userId: string,
    response: any,
    rpId: string,
    origin: string,
  ): Promise<boolean> {
    const user = await this.userStore.findById(userId);
    if (!user) throw new Error('User not found');

    const stored = this.challenges.get(user.username);
    if (!stored || new Date() > stored.expiresAt) {
      throw new Error('Challenge expired or not found');
    }

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw new Error('Registration verification failed');
    }

    const { credential } = verification.registrationInfo;

    await this.userStore.addWebAuthnCredential(userId, {
      credentialId: credential.id,
      publicKey:    credential.publicKey,
      counter:      credential.counter,
      transports:   response.response.transports as string[] | undefined,
      createdAt:    new Date(),
    });

    this.challenges.delete(user.username);
    logger.info('WebAuthn credential registered', { username: user.username });
    return true;
  }

  // ── WebAuthn Authentication ───────────────────────────────────────────────

  async webauthnLoginOptions(username: string, rpId: string): Promise<any> {
    const hasPasskey = this.userStore.hasWebAuthnCredentials(username);
    if (!hasPasskey) {
      return { available: false };
    }

    const creds = this.userStore.getWebAuthnCredentials(username);

    const options = await generateAuthenticationOptions({
      rpID: rpId,
      allowCredentials: creds.map(c => ({
        id: c.credentialId,
        transports: (c.transports || []) as any[],
      })),
      userVerification: 'preferred',
    });

    this.challenges.set(username, {
      challenge: options.challenge,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    });

    return { available: true, ...options };
  }

  async webauthnLoginVerify(
    username: string,
    response: any,
    rpId: string,
    origin: string,
  ): Promise<Session> {
    const user = await this.userStore.findByUsername(username);
    if (!user) throw new Error('User not found');

    const stored = this.challenges.get(username);
    if (!stored || new Date() > stored.expiresAt) {
      throw new Error('Challenge expired or not found');
    }

    const cred = user.webauthnCredentials.find(c => c.credentialId === response.id);
    if (!cred) throw new Error('Credential not found for this user');

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: stored.challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
      credential: {
        id: cred.credentialId,
        publicKey: cred.publicKey,
        counter: cred.counter,
      },
    });

    if (!verification.verified) {
      throw new Error('Authentication verification failed');
    }

    // Update counter
    await this.userStore.updateCredentialCounter(
      user.id, cred.credentialId, verification.authenticationInfo.newCounter,
    );

    this.challenges.delete(username);
    logger.info('WebAuthn login successful', { username });
    return this.createSession(user);
  }

  hasPasskey(username: string): boolean {
    return this.userStore.hasWebAuthnCredentials(username);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private createSession(user: User): Session {
    // Invalidate any existing session for this user
    for (const [token, sess] of this.sessions) {
      if (sess.userId === user.id) this.sessions.delete(token);
    }

    const session: Session = {
      token: crypto.randomBytes(32).toString('hex'),
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    };

    this.sessions.set(session.token, session);
    logger.info('Session created', { username: user.username, role: user.role });
    return session;
  }
}
