import type { NextFunction, Request, Response } from 'express';
import { db } from '../db.js';
import { config } from '../config.js';
import { randomToken, sha256 } from './crypto.js';

export const SESSION_COOKIE = 'vx_session';

export interface AuthUser {
  id: number;
  username: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function createSession(userId: number, req: Request) {
  const token = randomToken();
  const expires = new Date(Date.now() + config.sessionTtlHours * 3600_000);
  db.prepare('INSERT INTO auth_sessions(token_hash, user_id, expires_at, ip, user_agent) VALUES (?,?,?,?,?)').run(
    sha256(token),
    userId,
    expires.toISOString(),
    req.ip ?? null,
    (req.get('user-agent') ?? '').slice(0, 200),
  );
  return { token, expires };
}

export function setSessionCookie(res: Response, token: string, expires: Date) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.isProd,
    expires,
    path: '/',
  });
}

export function destroySession(token: string | undefined) {
  if (token) db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(sha256(token));
}

export function userFromRequest(req: Request): AuthUser | undefined {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!token) return undefined;
  const row = db
    .prepare(
      `SELECT u.id, u.username, s.expires_at FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
    )
    .get(sha256(token)) as { id: number; username: string; expires_at: string } | undefined;
  if (!row) return undefined;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    destroySession(token);
    return undefined;
  }
  return { id: row.id, username: row.username };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const user = userFromRequest(req);
  if (!user) {
    res.status(401).json({ error: 'Authentification requise' });
    return;
  }
  req.user = user;
  next();
}

/**
 * Protection CSRF : toute requête modifiant l'état doit porter l'en-tête X-Voynich-Client.
 * Un navigateur ne peut pas l'ajouter en cross-origin sans pré-requête CORS (que l'API refuse).
 */
export function csrfGuard(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-voynich-client') !== '1') {
    res.status(403).json({ error: 'En-tête client manquant (CSRF)' });
    return;
  }
  next();
}

export function audit(req: Request, action: string, detail?: unknown) {
  db.prepare('INSERT INTO audit_log(user_id, action, detail, ip) VALUES (?,?,?,?)').run(
    req.user?.id ?? null,
    action,
    detail === undefined ? null : typeof detail === 'string' ? detail : JSON.stringify(detail),
    req.ip ?? null,
  );
}

export function purgeExpiredSessions() {
  db.prepare(`DELETE FROM auth_sessions WHERE expires_at < ?`).run(new Date().toISOString());
}
