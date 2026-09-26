import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
/** Dossier de données ; si DATA_DIR n'est pas inscriptible, repli sur ./data plutôt qu'un crash au démarrage. */
function resolveDataDir() {
    const fallback = path.join(process.cwd(), 'data');
    for (const dir of [process.env.DATA_DIR, fallback]) {
        if (!dir)
            continue;
        try {
            const abs = path.resolve(dir);
            fs.mkdirSync(path.join(abs, 'uploads'), { recursive: true });
            fs.accessSync(abs, fs.constants.W_OK);
            return abs;
        }
        catch (err) {
            console.error(`[config] ⚠ dossier de données inutilisable (${dir}) : ${err.message}`);
        }
    }
    throw new Error('Aucun dossier de données inscriptible (DATA_DIR).');
}
const root = resolveDataDir();
/**
 * Secret maître : sert à chiffrer les clés API au repos (AES-256-GCM).
 * En production il DOIT venir de l'environnement (APP_SECRET).
 * En développement, on en génère un et on le persiste dans data/.secret.
 */
function loadSecret() {
    const fromEnv = process.env.APP_SECRET;
    if (fromEnv && fromEnv.length >= 32)
        return fromEnv;
    const file = path.join(root, '.secret');
    if (process.env.NODE_ENV === 'production') {
        // Plutôt qu'un crash silencieux (l'hébergeur n'affiche alors qu'un 403/503),
        // on démarre avec un secret persisté dans DATA_DIR et on le signale fort.
        console.error('[config] ⚠ APP_SECRET (>= 32 caractères) manquant en production : définissez-le dans les variables d’environnement.');
    }
    if (fs.existsSync(file))
        return fs.readFileSync(file, 'utf8').trim();
    const generated = crypto.randomBytes(48).toString('base64url');
    fs.writeFileSync(file, generated, { mode: 0o600 });
    console.warn(`[config] APP_SECRET absent : secret généré dans ${file}`);
    return generated;
}
export const config = {
    env: process.env.NODE_ENV ?? 'development',
    isProd: process.env.NODE_ENV === 'production',
    /** Numéro de port, ou chemin de socket fourni par certains hébergeurs (Passenger/LiteSpeed). */
    port: /^\d+$/.test(process.env.PORT ?? '') ? Number(process.env.PORT) : (process.env.PORT ?? 8787),
    /** Si l'hébergeur fournit PORT, on écoute sur toutes les interfaces (sauf HOST explicite). */
    host: process.env.HOST ?? (process.env.PORT ? undefined : '127.0.0.1'),
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
//# sourceMappingURL=config.js.map