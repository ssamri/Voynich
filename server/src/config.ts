import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), 'data'));
fs.mkdirSync(root, { recursive: true });
fs.mkdirSync(path.join(root, 'uploads'), { recursive: true });

/**
 * Secret maître : sert à chiffrer les clés API au repos (AES-256-GCM).
 * En production il DOIT venir de l'environnement (APP_SECRET).
 * En développement, on en génère un et on le persiste dans data/.secret.
 */
function loadSecret(): string {
  const fromEnv = process.env.APP_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('APP_SECRET (>= 32 caractères) est obligatoire en production.');
  }
  const file = path.join(root, '.secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const generated = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(file, generated, { mode: 0o600 });
  console.warn(`[config] APP_SECRET absent : secret de développement généré dans ${file}`);
  return generated;
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '127.0.0.1',
  dataDir: root,
  uploadsDir: path.join(root, 'uploads'),
  dbFile: path.join(root, 'voynich.db'),
  secret: loadSecret(),
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 12),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 40),
  /** Autorise l'inscription du premier administrateur uniquement si aucun compte n'existe. */
  setupToken: process.env.SETUP_TOKEN ?? '',
  corpusDefaultUrl: process.env.CORPUS_URL ?? 'https://www.voynich.nu/data/ZL3b-n.txt',
  trustProxy: process.env.TRUST_PROXY === '1',
};
