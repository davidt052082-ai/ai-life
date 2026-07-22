import { randomUUID } from "node:crypto";

export const SESSION_COOKIE_NAME = "ai_life_session";

function sessionCookieOptions(sessionLifetimeMs) {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: sessionLifetimeMs,
    signed: true,
    path: "/"
  };
}

export function createSessionService(repository, options = {}) {
  const sessionLifetimeMs = options.sessionLifetimeMs ?? 1000 * 60 * 60 * 24 * 14;

  return {
    async signIn(res, userId) {
      const id = randomUUID();
      const expiresAt = new Date(Date.now() + sessionLifetimeMs);
      await repository.createSession({ id, userId, expiresAt });
      res.cookie(SESSION_COOKIE_NAME, id, sessionCookieOptions(sessionLifetimeMs));
      return { id, expiresAt };
    },

    async getCurrentUser(req) {
      const sessionId = req.signedCookies?.[SESSION_COOKIE_NAME];
      if (!sessionId) return null;
      return repository.findActiveSession(sessionId);
    },

    async signOut(req, res) {
      const sessionId = req.signedCookies?.[SESSION_COOKIE_NAME];
      if (sessionId) await repository.deleteSession(sessionId);
      res.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions(sessionLifetimeMs));
    }
  };
}
