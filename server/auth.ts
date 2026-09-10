import { UserSession } from './types';
import { v4 as uuidv4 } from 'uuid';

// In-memory session store
const sessions = new Map<string, UserSession>();

// Default session lifespan: 15 minutes
export const SESSION_DURATION_MS = 15 * 60 * 1000;

export function createSession(email: string, name: string): UserSession {
  const token = `cpe_sess_${uuidv4()}`;
  const now = Date.now();
  const session: UserSession = {
    userId: `usr_${uuidv4().substring(0, 8)}`,
    email,
    name,
    token,
    createdAt: now,
    expiresAt: now + SESSION_DURATION_MS,
    isValid: true
  };
  sessions.set(token, session);
  return session;
}

export function getSession(token?: string): UserSession | null {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;

  // Check validity and expiration
  if (!session.isValid || Date.now() > session.expiresAt) {
    session.isValid = false;
    return null;
  }

  return session;
}

export function invalidateSession(token: string): boolean {
  const session = sessions.get(token);
  if (session) {
    session.isValid = false;
    session.expiresAt = Date.now() - 1000; // Expired in past
    return true;
  }
  return false;
}

export function invalidateAllSessionsForUser(email: string): void {
  for (const session of sessions.values()) {
    if (session.email === email) {
      session.isValid = false;
      session.expiresAt = Date.now() - 1000;
    }
  }
}

export function getAllActiveSessions(): UserSession[] {
  const now = Date.now();
  return Array.from(sessions.values()).filter(s => s.isValid && s.expiresAt > now);
}
