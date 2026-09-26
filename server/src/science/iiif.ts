import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { db, getSetting, setSetting } from '../db.js';
import { config } from '../config.js';
import { assertPublicUrl, fetchUrl } from '../web/search.js';

/**
 * Images du manuscrit via IIIF (standard des bibliothèques numériques).
 * Le manifeste de la Beinecke décrit chaque page (« canvas ») et son service d'images.
 */
export const DEFAULT_MANIFEST = process.env.IIIF_MANIFEST ?? 'https://collections.library.yale.edu/manifests/2002046';
const cacheDir = path.join(config.dataDir, 'iiif-cache');
fs.mkdirSync(cacheDir, { recursive: true });

type Json = Record<string, any>;

function labelText(label: unknown): string {
  if (typeof label === 'string') return label;
  if (Array.isArray(label)) return labelText(label[0]);
  if (label && typeof label === 'object') {
    const l = label as Json;
    if ('@value' in l) return String(l['@value']);
    const first = Object.values(l)[0];
    return Array.isArray(first) ? String(first[0]) : String(first ?? '');
  }
  return '';
}

/** « 1r », « f. 67r1 », « Folio 102v2 » → « f1r », « f67r1 », « f102v2 » */
export function folioFromLabel(label: string) {
  const m = /(\d+)\s*([rv])\s*(\d*)/i.exec(label);
  return m ? `f${Number(m[1])}${m[2].toLowerCase()}${m[3] ?? ''}` : null;
}

export async function importManifest(url = DEFAULT_MANIFEST) {
  const page = await fetchUrl(url);
  const manifest = JSON.parse(page.text) as Json;
  const canvases: Json[] = manifest.items ?? manifest.sequences?.[0]?.canvases ?? [];
  if (!canvases.length) throw new Error('Manifeste IIIF sans pages (canvases).');
  const rows: { folio: string; label: string; service: string | null; image: string | null; width: number | null; height: number | null; ord: number }[] = [];
  const unmatched: string[] = [];
  canvases.forEach((cv, i) => {
    const label = labelText(cv.label);
    const folio = folioFromLabel(label);
    // IIIF v3 : canvas.items[0].items[0].body ; v2 : canvas.images[0].resource
    const body = cv.items?.[0]?.items?.[0]?.body ?? cv.images?.[0]?.resource;
    const svc = body?.service;
    const service = (Array.isArray(svc) ? svc[0] : svc)?.id ?? (Array.isArray(svc) ? svc[0] : svc)?.['@id'] ?? null;
    const image = body?.id ?? body?.['@id'] ?? null;
    if (!folio) {
      unmatched.push(label);
      return;
    }
    rows.push({ folio, label, service, image, width: cv.width ?? null, height: cv.height ?? null, ord: i });
  });
  db.transaction(() => {
    db.exec('DELETE FROM folio_images');
    const ins = db.prepare('INSERT OR IGNORE INTO folio_images(folio, canvas_label, image_service, image_url, width, height, ord) VALUES (?,?,?,?,?,?,?)');
    for (const r of rows) ins.run(r.folio, r.label, r.service, r.image, r.width, r.height, r.ord);
    setSetting('iiif', JSON.stringify({ manifest: url, importedAt: new Date().toISOString(), title: labelText(manifest.label) }));
  })();
  return { imported: rows.length, unmatched };
}

export function iiifInfo() {
  const meta = JSON.parse(getSetting('iiif') ?? '{}');
  const n = (db.prepare('SELECT COUNT(*) AS n FROM folio_images').get() as { n: number }).n;
  return { ...meta, defaultManifest: DEFAULT_MANIFEST, images: n };
}

export function listImages() {
  return db.prepare('SELECT folio, canvas_label, width, height FROM folio_images ORDER BY ord').all();
}

interface ImgRow {
  folio: string;
  image_service: string | null;
  image_url: string | null;
}

/** URL IIIF d'une page ou d'une zone (coordonnées relatives 0–1). */
function iiifUrl(row: ImgRow, size: number, region?: { x: number; y: number; w: number; h: number }) {
  if (!row.image_service) {
    if (!row.image_url) throw new Error(`Pas d’image pour ${row.folio}`);
    return row.image_url;
  }
  const r = region
    ? `pct:${(region.x * 100).toFixed(2)},${(region.y * 100).toFixed(2)},${(region.w * 100).toFixed(2)},${(region.h * 100).toFixed(2)}`
    : 'full';
  return `${row.image_service.replace(/\/$/, '')}/${r}/!${size},${size}/0/default.jpg`;
}

/** Récupère une image (avec cache disque) : sert à l'interface et aux agents multimodaux. */
export async function folioImage(folio: string, opts: { size?: number; region?: { x: number; y: number; w: number; h: number } } = {}) {
  const row = db.prepare('SELECT folio, image_service, image_url FROM folio_images WHERE folio = ?').get(folio) as ImgRow | undefined;
  if (!row) throw new Error(`Aucune image pour ${folio} (importer le manifeste IIIF dans la page Manuscrit).`);
  const size = Math.min(Math.max(opts.size ?? 1600, 200), 4000);
  const url = iiifUrl(row, size, opts.region);
  const file = path.join(cacheDir, `${crypto.createHash('sha1').update(url).digest('hex')}.jpg`);
  if (fs.existsSync(file)) return { mediaType: 'image/jpeg', data: fs.readFileSync(file) };
  const u = new URL(url);
  await assertPublicUrl(u);
  const res = await fetch(u, { signal: AbortSignal.timeout(30_000), headers: { 'User-Agent': 'VoynichLab/1.0' } });
  if (!res.ok) throw new Error(`Image IIIF indisponible (${res.status})`);
  const data = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(file, data);
  return { mediaType: res.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg', data };
}

export interface AnnotationRow {
  id: number;
  folio: string;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: string;
  locus: string | null;
  title: string | null;
  note: string | null;
  author_label: string | null;
  created_at: string;
}

export function listAnnotations(folio?: string) {
  return (folio
    ? db.prepare('SELECT * FROM annotations WHERE folio = ? ORDER BY id').all(folio)
    : db.prepare('SELECT * FROM annotations ORDER BY folio, id').all()) as AnnotationRow[];
}

export function addAnnotation(a: Omit<AnnotationRow, 'id' | 'created_at'>) {
  const info = db
    .prepare('INSERT INTO annotations(folio, x, y, w, h, kind, locus, title, note, author_label) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(a.folio, a.x, a.y, a.w, a.h, a.kind, a.locus, a.title, a.note, a.author_label);
  return Number(info.lastInsertRowid);
}

export function updateAnnotation(id: number, a: Partial<Omit<AnnotationRow, 'id' | 'created_at'>>) {
  const cur = db.prepare('SELECT * FROM annotations WHERE id = ?').get(id) as AnnotationRow | undefined;
  if (!cur) throw new Error('Annotation introuvable');
  const n = { ...cur, ...a };
  db.prepare('UPDATE annotations SET x=?, y=?, w=?, h=?, kind=?, locus=?, title=?, note=? WHERE id=?').run(n.x, n.y, n.w, n.h, n.kind, n.locus, n.title, n.note, id);
}

export function deleteAnnotation(id: number) {
  db.prepare('DELETE FROM annotations WHERE id = ?').run(id);
}
