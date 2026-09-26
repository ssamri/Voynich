import { Router } from 'express';
import { z } from 'zod';
import { audit } from '../security/auth.js';
import { addAnnotation, deleteAnnotation, folioImage, iiifInfo, importManifest, listAnnotations, listImages, updateAnnotation } from '../science/iiif.js';

export const manuscriptRouter = Router();

manuscriptRouter.get('/info', (_req, res) => res.json(iiifInfo()));
manuscriptRouter.post('/import', async (req, res) => {
  const { url } = z.object({ url: z.string().url().optional() }).parse(req.body ?? {});
  const r = await importManifest(url);
  audit(req, 'manuscript.import', { url, imported: r.imported });
  res.json(r);
});
manuscriptRouter.get('/images', (_req, res) => res.json(listImages()));
manuscriptRouter.get('/images/:folio', async (req, res) => {
  const size = Number(req.query.size ?? 1600);
  const region = req.query.region ? z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }).parse(JSON.parse(String(req.query.region))) : undefined;
  const img = await folioImage(req.params.folio, { size, region });
  res.setHeader('Content-Type', img.mediaType);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.send(img.data);
});

const ann = z.object({
  folio: z.string().regex(/^f\d+[rv]\d*$/),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
  kind: z.string().max(30).default('label'),
  locus: z.string().max(40).nullable().optional(),
  title: z.string().max(200).nullable().optional(),
  note: z.string().max(5000).nullable().optional(),
});
manuscriptRouter.get('/annotations', (req, res) => res.json(listAnnotations(req.query.folio ? String(req.query.folio) : undefined)));
manuscriptRouter.post('/annotations', (req, res) => {
  const a = ann.parse(req.body);
  res.json({ id: addAnnotation({ ...a, locus: a.locus ?? null, title: a.title ?? null, note: a.note ?? null, author_label: 'Chercheur principal' }) });
});
manuscriptRouter.put('/annotations/:id', (req, res) => {
  updateAnnotation(Number(req.params.id), ann.partial().parse(req.body));
  res.json({ ok: true });
});
manuscriptRouter.delete('/annotations/:id', (req, res) => {
  deleteAnnotation(Number(req.params.id));
  res.json({ ok: true });
});
