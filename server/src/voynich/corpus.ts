import { db, getSetting, setSetting } from '../db.js';
import { parseIvtff } from './ivtff.js';
import { invalidateCorpusCache } from './analysis.js';

export interface CorpusInfo {
  source: string | null;
  importedAt: string | null;
  transcriber: string | null;
  transcribers: string[];
  pages: number;
  lines: number;
}

export function importCorpus(content: string, source: string, transcriber = 'H') {
  const parsed = parseIvtff(content, transcriber);
  if (parsed.lines.length === 0) {
    throw new Error("Aucune ligne IVTFF reconnue. Vérifiez qu'il s'agit bien d'un fichier au format IVTFF (EVA).");
  }
  db.transaction(() => {
    db.exec('DELETE FROM corpus_lines; DELETE FROM corpus_pages;');
    const ip = db.prepare(
      'INSERT INTO corpus_pages(folio, ord, quire, panel, illustration, language, hand, header) VALUES (?,?,?,?,?,?,?,?)',
    );
    for (const p of parsed.pages) {
      ip.run(p.folio, p.ord, p.quire ?? null, p.panel ?? null, p.illustration ?? null, p.language ?? null, p.hand ?? null, p.header);
    }
    const il = db.prepare('INSERT INTO corpus_lines(folio, ord, locus, locus_type, transcriber, raw, text) VALUES (?,?,?,?,?,?,?)');
    for (const l of parsed.lines) il.run(l.folio, l.ord, l.locus, l.locusType ?? null, l.transcriber ?? null, l.raw, l.text);
    setSetting(
      'corpus',
      JSON.stringify({ source, importedAt: new Date().toISOString(), transcriber, transcribers: parsed.transcribers }),
    );
  })();
  invalidateCorpusCache();
  return corpusInfo();
}

export async function importCorpusFromUrl(url: string, transcriber = 'H') {
  const u = new URL(url);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('URL invalide');
  const res = await fetch(u, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Téléchargement impossible (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  // Les fichiers IVTFF de voynich.nu sont en ISO-8859-1.
  const text = buf.toString('latin1');
  return importCorpus(text, url, transcriber);
}

export function corpusInfo(): CorpusInfo {
  const meta = JSON.parse(getSetting('corpus') ?? '{}');
  const pages = (db.prepare('SELECT COUNT(*) AS n FROM corpus_pages').get() as { n: number }).n;
  const lines = (db.prepare('SELECT COUNT(*) AS n FROM corpus_lines').get() as { n: number }).n;
  return {
    source: meta.source ?? null,
    importedAt: meta.importedAt ?? null,
    transcriber: meta.transcriber ?? null,
    transcribers: meta.transcribers ?? [],
    pages,
    lines,
  };
}

export function listPages() {
  return db
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM corpus_lines l WHERE l.folio = p.folio) AS line_count
       FROM corpus_pages p ORDER BY p.ord`,
    )
    .all();
}

export function getPage(folio: string) {
  const page = db.prepare('SELECT * FROM corpus_pages WHERE folio = ?').get(folio);
  if (!page) return null;
  const lines = db.prepare('SELECT locus, locus_type, transcriber, raw, text FROM corpus_lines WHERE folio = ? ORDER BY ord').all(folio);
  return { page, lines };
}
