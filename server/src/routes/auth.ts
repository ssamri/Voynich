import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { db } from '../db.js';
import { config } from '../config.js';
import { hashPassword, verifyPassword } from '../security/crypto.js';
import {
  SESSION_COOKIE,
  audit,
  createSession,
  destroySession,
  requireAuth,
  setSessionCookie,
  userFromRequest,
} from '../security/auth.js';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Trop de tentatives, réessayez dans 15 minutes.' },
});

const credentials = z.object({
  username: z.string().trim().min(3).max(64),
  password: z.string().min(10, 'Le mot de passe doit faire au moins 10 caractères').max(256),
});

function userCount() {
  return (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
}

authRouter.get('/status', (req, res) => {
  const user = userFromRequest(req);
  res.json({ needsSetup: userCount() === 0, requiresSetupToken: Boolean(config.setupToken), user: user ?? null });
});

authRouter.post('/setup', loginLimiter, async (req, res) => {
  if (userCount() > 0) {
    res.status(409).json({ error: 'Un administrateur existe déjà.' });
    return;
  }
  if (config.setupToken && req.body?.setupToken !== config.setupToken) {
    res.status(403).json({ error: "Jeton d'installation invalide." });
    return;
  }
  const body = credentials.parse(req.body);
  const hash = await hashPassword(body.password);
  const info = db.prepare('INSERT INTO users(username, password_hash) VALUES (?, ?)').run(body.username, hash);
  const user = { id: Number(info.lastInsertRowid), username: body.username };
  req.user = user;
  audit(req, 'auth.setup');
  const { token, expires } = createSession(user.id, req);
  setSessionCookie(res, token, expires);
  res.json({ user });
});

authRouter.post('/login', loginLimiter, async (req, res) => {
  const body = credentials.pick({ username: true }).extend({ password: z.string().min(1).max(256) }).parse(req.body);
  const row = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(body.username) as
    | { id: number; username: string; password_hash: string }
    | undefined;
  // Toujours exécuter scrypt pour ne pas révéler l'existence du compte par le temps de réponse.
  const ok = await verifyPassword(body.password, row?.password_hash ?? 'scrypt$32768$AAAAAAAAAAAAAAAAAAAAAA$AAAA');
  if (!row || !ok) {
    audit(req, 'auth.login_failed', { username: body.username });
    res.status(401).json({ error: 'Identifiants invalides' });
    return;
  }
  req.user = { id: row.id, username: row.username };
  db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(row.id);
  audit(req, 'auth.login');
  const { token, expires } = createSession(row.id, req);
  setSessionCookie(res, token, expires);
  res.json({ user: req.user });
});

authRouter.post('/logout', (req, res) => {
  destroySession(req.cookies?.[SESSION_COOKIE]);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

authRouter.post('/password', requireAuth, async (req, res) => {
  const body = z
    .object({ current: z.string().min(1), next: z.string().min(10).max(256) })
    .parse(req.body);
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user!.id) as { password_hash: string };
  if (!(await verifyPassword(body.current, row.password_hash))) {
    res.status(400).json({ error: 'Mot de passe actuel incorrect' });
    return;
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(body.next), req.user!.id);
  // Révoque toutes les autres sessions.
  db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(req.user!.id);
  const { token, expires } = createSession(req.user!.id, req);
  setSessionCookie(res, token, expires);
  audit(req, 'auth.password_changed');
  res.json({ ok: true });
});

authRouter.get('/sessions', requireAuth, (req, res) => {
  res.json(
    db
      .prepare('SELECT created_at, expires_at, ip, user_agent FROM auth_sessions WHERE user_id = ? ORDER BY created_at DESC')
      .all(req.user!.id),
  );
});

authRouter.get('/audit', requireAuth, (_req, res) => {
  res.json(db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200').all());
});
