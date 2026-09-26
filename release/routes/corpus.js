import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { audit } from '../security/auth.js';
import { config } from '../config.js';
import { corpusInfo, getPage, importCorpus, importCorpusFromUrl, listPages } from '../voynich/corpus.js';
import * as analysis from '../voynich/analysis.js';
import { ILLUSTRATION_LABELS } from '../voynich/ivtff.js';
export const corpusRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });
const filter = z.object({
    illustration: z.string().max(2).optional(),
    language: z.string().max(2).optional(),
    hand: z.string().max(3).optional(),
});
function parseFilter(q, prefix = '') {
    const f = filter.parse({
        illustration: q[`${prefix}illustration`] || undefined,
        language: q[`${prefix}language`] || undefined,
        hand: q[`${prefix}hand`] || undefined,
    });
    return f;
}
corpusRouter.get('/info', (_req, res) => res.json({ ...corpusInfo(), defaultUrl: config.corpusDefaultUrl, sections: ILLUSTRATION_LABELS }));
corpusRouter.post('/import/url', async (req, res) => {
    const { url, transcriber } = z.object({ url: z.string().url(), transcriber: z.string().max(3).default('H') }).parse(req.body);
    const info = await importCorpusFromUrl(url, transcriber);
    audit(req, 'corpus.import', { url, lines: info.lines });
    res.json(info);
});
corpusRouter.post('/import/file', upload.single('file'), (req, res) => {
    if (!req.file) {
        res.status(400).json({ error: 'Fichier manquant' });
        return;
    }
    const transcriber = String(req.body.transcriber || 'H').slice(0, 3);
    const content = req.file.buffer.toString('latin1');
    const info = importCorpus(content, `fichier : ${req.file.originalname}`, transcriber);
    audit(req, 'corpus.import', { file: req.file.originalname, lines: info.lines });
    res.json(info);
});
corpusRouter.get('/pages', (_req, res) => res.json(listPages()));
corpusRouter.get('/pages/:folio', (req, res) => {
    const p = getPage(req.params.folio);
    if (!p) {
        res.status(404).json({ error: 'Folio introuvable' });
        return;
    }
    res.json(p);
});
corpusRouter.get('/overview', (req, res) => res.json(analysis.overview(parseFilter(req.query))));
corpusRouter.get('/positional', (req, res) => res.json(analysis.positional(parseFilter(req.query))));
corpusRouter.get('/ngrams', (req, res) => {
    const n = Math.min(5, Math.max(1, Number(req.query.n ?? 2)));
    const level = req.query.level === 'word' ? 'word' : 'char';
    res.json(analysis.ngrams(n, parseFilter(req.query), 60, level));
});
corpusRouter.get('/compare', (req, res) => res.json(analysis.compare(parseFilter(req.query, 'a_'), parseFilter(req.query, 'b_'))));
corpusRouter.get('/search', (req, res) => {
    const q = String(req.query.q ?? '');
    if (!q) {
        res.json({ total: 0, lines: 0, hits: [] });
        return;
    }
    res.json(analysis.search(q, { regex: req.query.regex === '1', filter: parseFilter(req.query), limit: 300 }));
});
corpusRouter.post('/substitute', (req, res) => {
    const b = z.object({ mapping: z.record(z.string(), z.string()), folio: z.string().optional(), text: z.string().max(20000).optional() }).parse(req.body);
    const source = b.folio ? analysis.folioText(b.folio).map((l) => l.text).join('\n') : b.text ?? '';
    res.json(source.split('\n').map((l) => ({ source: l, ...analysis.substitute(l, b.mapping) })));
});
//# sourceMappingURL=corpus.js.map