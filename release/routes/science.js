import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { audit } from '../security/auth.js';
import { LAB_SCHEMAS, replayExperiment, runLab } from '../science/lab.js';
import { getExperiment, listExperiments, registerTest } from '../science/experiments.js';
import { DEFAULT_CRITERIA } from '../science/evaluate.js';
import { GENERATORS } from '../science/generators.js';
import { deleteRef, generateRef, getRef, importRefFromText, importRefFromUrl, listRefs, fingerprintFor } from '../science/sources.js';
import { addCrib, cribConstraints, deleteCrib, listCribs, updateCrib } from '../science/cribs.js';
import { dispersion, glyphHeatmap, pageMap } from '../science/viz.js';
import { FEATURES } from '../science/fingerprint.js';
export const scienceRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });
const HUMAN = { authorLabel: 'Chercheur principal' };
// ── Corpus de référence ──
scienceRouter.get('/refs', (_req, res) => res.json({ refs: listRefs(), generators: GENERATORS, features: FEATURES }));
scienceRouter.get('/refs/:id', (req, res) => {
    const r = getRef(Number(req.params.id));
    if (!r) {
        res.status(404).json({ error: 'Corpus introuvable' });
        return;
    }
    res.json({ ...r, text: r.text.slice(0, 3000), fingerprint: fingerprintFor(`ref:${r.id}`) });
});
const refMeta = z.object({
    name: z.string().trim().min(1).max(200),
    language: z.string().trim().max(40).optional(),
    genre: z.string().trim().max(100).optional(),
    medievalLatin: z.boolean().optional(),
    stripDiacritics: z.boolean().optional(),
});
scienceRouter.post('/refs/url', async (req, res) => {
    const b = refMeta.extend({ url: z.string().url() }).parse(req.body);
    const id = await importRefFromUrl(b.url, b);
    audit(req, 'science.ref_import', { id, url: b.url });
    res.json({ id });
});
scienceRouter.post('/refs/text', (req, res) => {
    const b = refMeta.extend({ text: z.string().min(100).max(20_000_000), source: z.string().max(500).optional() }).parse(req.body);
    res.json({ id: importRefFromText(b.text, b) });
});
scienceRouter.post('/refs/file', upload.single('file'), (req, res) => {
    if (!req.file) {
        res.status(400).json({ error: 'Fichier manquant' });
        return;
    }
    const meta = refMeta.parse({ ...req.body, medievalLatin: req.body.medievalLatin === 'true', stripDiacritics: req.body.stripDiacritics === 'true' });
    res.json({ id: importRefFromText(req.file.buffer.toString('utf8'), { ...meta, source: req.file.originalname }) });
});
scienceRouter.post('/refs/generate', (req, res) => {
    const b = z
        .object({
        kind: z.enum(GENERATORS.map((g) => g.kind)),
        sourceRefId: z.number().int().optional(),
        voynichSource: z.string().optional(),
        length: z.number().int().min(500).max(100000).optional(),
        seed: z.number().int().optional(),
        name: z.string().max(200).optional(),
    })
        .parse(req.body);
    res.json({ id: generateRef(b.kind, b) });
});
scienceRouter.delete('/refs/:id', (req, res) => {
    deleteRef(Number(req.params.id));
    res.json({ ok: true });
});
// ── Laboratoire : exécution et journal ──
scienceRouter.post('/run/:kind', async (req, res) => {
    const kind = req.params.kind;
    if (!(kind in LAB_SCHEMAS)) {
        res.status(404).json({ error: 'Analyse inconnue' });
        return;
    }
    const { test_id, ...params } = req.body ?? {};
    res.json(await runLab(kind, params, { ...HUMAN, experimentId: test_id ?? null }));
});
scienceRouter.post('/tests', (req, res) => {
    const b = z
        .object({
        title: z.string().min(3).max(200),
        hypothesis: z.string().min(3).max(3000),
        minCoverage: z.number().min(0).max(1).default(DEFAULT_CRITERIA.minCoverage),
        minPercentile: z.number().min(0.5).max(1).default(DEFAULT_CRITERIA.minPercentile),
        minDictionaryRate: z.number().min(0).max(1).default(DEFAULT_CRITERIA.minDictionaryRate),
    })
        .parse(req.body);
    const { title, hypothesis, ...criteria } = b;
    res.json({ id: registerTest({ kind: 'evaluate', title, criteria, params: { hypothesis }, ...HUMAN }) });
});
scienceRouter.get('/experiments', (req, res) => {
    res.json(listExperiments({ kind: req.query.kind ? String(req.query.kind) : undefined, sessionId: req.query.session ? Number(req.query.session) : undefined }));
});
scienceRouter.get('/experiments/:id', (req, res) => {
    const e = getExperiment(Number(req.params.id));
    if (!e) {
        res.status(404).json({ error: 'Expérience introuvable' });
        return;
    }
    res.json({ ...e, params: JSON.parse(e.params), criteria: e.criteria ? JSON.parse(e.criteria) : null, result: e.result ? JSON.parse(e.result) : null });
});
scienceRouter.post('/experiments/:id/replay', async (req, res) => res.json(await replayExperiment(Number(req.params.id), HUMAN)));
// ── Indices (cribs) ──
const cribInput = z.object({
    eva: z.string().trim().min(1).max(60),
    expected: z.string().trim().min(1).max(60),
    folio: z.string().max(20).optional(),
    locus: z.string().max(40).optional(),
    language: z.string().max(40).optional(),
    category: z.string().max(40).optional(),
    source: z.string().max(500).optional(),
    confidence: z.number().min(0).max(1).optional(),
    notes: z.string().max(3000).optional(),
});
scienceRouter.get('/cribs', (_req, res) => res.json(listCribs()));
scienceRouter.get('/cribs/constraints', (req, res) => res.json(cribConstraints(req.query.alphabet === 'eva' ? 'eva' : 'eva-grouped')));
scienceRouter.post('/cribs', (req, res) => res.json({ id: addCrib({ ...cribInput.parse(req.body), authorLabel: HUMAN.authorLabel }) }));
scienceRouter.put('/cribs/:id', (req, res) => {
    updateCrib(Number(req.params.id), cribInput.partial().parse(req.body));
    res.json({ ok: true });
});
scienceRouter.delete('/cribs/:id', (req, res) => {
    deleteCrib(Number(req.params.id));
    res.json({ ok: true });
});
// ── Visualisations ──
scienceRouter.get('/viz/heatmap', (_req, res) => res.json(glyphHeatmap()));
scienceRouter.get('/viz/pages', (_req, res) => res.json(pageMap()));
scienceRouter.get('/viz/dispersion', (req, res) => res.json(dispersion(String(req.query.q ?? ''), req.query.regex === '1')));
//# sourceMappingURL=science.js.map