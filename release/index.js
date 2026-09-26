import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { ZodError } from 'zod';
import { config } from './config.js';
import { db } from './db.js';
import { csrfGuard, purgeExpiredSessions, requireAuth } from './security/auth.js';
import { authRouter } from './routes/auth.js';
import { providersRouter } from './routes/providers.js';
import { agentsRouter } from './routes/agents.js';
import { libraryRouter } from './routes/library.js';
import { memoryRouter } from './routes/memory.js';
import { sessionsRouter } from './routes/sessions.js';
import { corpusRouter } from './routes/corpus.js';
import { dashboardRouter } from './routes/dashboard.js';
import { scienceRouter } from './routes/science.js';
import { manuscriptRouter } from './routes/manuscript.js';
import { startCampaignScheduler } from './orchestrator/campaigns.js';
const app = express();
if (config.trustProxy)
    app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            imgSrc: ["'self'", 'data:', 'blob:'],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com'],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            upgradeInsecureRequests: config.isProd ? [] : null,
        },
    },
    crossOriginEmbedderPolicy: false,
}));
app.use(express.json({ limit: '8mb' }));
app.use(cookieParser());
const api = express.Router();
api.use(csrfGuard);
api.use('/auth', authRouter);
api.get('/health', (_req, res) => res.json({ ok: true }));
api.use(requireAuth);
api.use('/dashboard', dashboardRouter);
api.use('/providers', providersRouter);
api.use('/agents', agentsRouter);
api.use('/library', libraryRouter);
api.use('/memory', memoryRouter);
api.use('/sessions', sessionsRouter);
api.use('/corpus', corpusRouter);
api.use('/science', scienceRouter);
api.use('/manuscript', manuscriptRouter);
api.use((_req, res) => res.status(404).json({ error: 'Route inconnue' }));
app.use('/api', api);
// En production, le serveur sert aussi le front compilé (client/dist).
const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = [path.join(here, 'public'), path.resolve(here, '../client/dist')].find((d) => fs.existsSync(path.join(d, 'index.html')));
if (clientDist) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}
app.use((err, _req, res, _next) => {
    if (err instanceof ZodError) {
        res.status(400).json({ error: err.issues.map((i) => `${i.path.join('.') || 'entrée'} : ${i.message}`).join(' ; ') });
        return;
    }
    const e = err;
    if (!e.status || e.status >= 500)
        console.error(err);
    res.status(e.status && e.status < 600 ? e.status : 500).json({ error: e.message ?? 'Erreur interne' });
});
// Une séance marquée « running » au démarrage a été interrompue par un redémarrage.
db.prepare(`UPDATE research_sessions SET status = 'idle' WHERE status = 'running'`).run();
purgeExpiredSessions();
setInterval(purgeExpiredSessions, 3600_000).unref();
startCampaignScheduler();
const onListen = () => console.log(`[voynich] API prête sur ${config.host ?? '*'}:${config.port} (${config.env}) — UI : ${clientDist ?? 'introuvable'}`);
if (typeof config.port === 'string')
    app.listen(config.port, onListen);
else if (config.host)
    app.listen(config.port, config.host, onListen);
else
    app.listen(config.port, onListen);
//# sourceMappingURL=index.js.map