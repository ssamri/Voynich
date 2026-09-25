/**
 * Parseur du format IVTFF (Intermediate Voynich Transliteration File Format, R. Zandbergen),
 * utilisé par les transcriptions EVA de référence (Landini-Stolfi, Zandbergen-Landini, Takahashi…).
 *
 *   <f1r>      <! $Q=A $P=A $F=a $B=1 $I=H $L=A $H=1>     ← en-tête de page
 *   <f1r.1,@P0>      fachys.ykal.ar.ataiin.shol...        ← ligne (locus)
 *   <f1r.1,@P0;H>    ...                                   ← variante avec code du transcripteur
 */

export interface ParsedPage {
  folio: string;
  ord: number;
  quire?: string;
  panel?: string;
  illustration?: string;
  language?: string;
  hand?: string;
  header: string;
}

export interface ParsedLine {
  folio: string;
  ord: number;
  locus: string;
  locusType?: string;
  transcriber?: string;
  raw: string;
  text: string;
}

export interface ParseResult {
  pages: ParsedPage[];
  lines: ParsedLine[];
  transcribers: string[];
}

const PAGE_RE = /^<(f\d+[rv]\d*)>\s*(.*)$/;
const LINE_RE = /^<(f\d+[rv]\d*)\.([^,>;]+),?([^;>]*)(?:;(\w+))?>\s*(.*)$/;

function pageVars(header: string) {
  const vars: Record<string, string> = {};
  for (const m of header.matchAll(/\$(\w)=(\w+)/g)) vars[m[1]] = m[2];
  return vars;
}

/** Nettoie une ligne IVTFF et renvoie une suite de mots EVA séparés par des espaces. */
export function cleanIvtffText(raw: string): string {
  let s = raw;
  s = s.replace(/<![^>]*>/g, ''); // commentaires en ligne
  s = s.replace(/<->|<~>|<=>/g, '.'); // ruptures (dessin, etc.) = séparateur de mots
  s = s.replace(/<[^>]*>/g, ''); // autres balises : <%> <$> <@…>
  s = s.replace(/\[([^\]:|]*)[:|][^\]]*\]/g, '$1'); // lectures alternatives [a:o] → a
  s = s.replace(/\{&(\d+)\}|@\d+;/g, '?'); // caractères rares / codes
  s = s.replace(/\{([^}]*)\}/g, '$1'); // ligatures {ch}
  s = s.replace(/[!%]/g, '');
  s = s.replace(/[,.\s]+/g, ' ');
  s = s.replace(/[^a-z?* ]/gi, '');
  return s.trim().toLowerCase();
}

export function parseIvtff(content: string, preferredTranscriber = 'H'): ParseResult {
  const pages = new Map<string, ParsedPage>();
  const byLocus = new Map<string, ParsedLine[]>();
  const transcribers = new Set<string>();
  let pageOrd = 0;
  let lineOrd = 0;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith('#')) continue;

    const lm = LINE_RE.exec(line);
    if (lm) {
      const [, folio, num, type, transcriber, body] = lm;
      if (!pages.has(folio)) pages.set(folio, { folio, ord: pageOrd++, header: '' });
      if (transcriber) transcribers.add(transcriber);
      const locus = `${folio}.${num}`;
      const entry: ParsedLine = {
        folio,
        ord: lineOrd++,
        locus,
        locusType: type?.replace(/^@/, '') || undefined,
        transcriber: transcriber || undefined,
        raw: body,
        text: cleanIvtffText(body),
      };
      const list = byLocus.get(locus) ?? [];
      list.push(entry);
      byLocus.set(locus, list);
      continue;
    }

    const pm = PAGE_RE.exec(line);
    if (pm) {
      const [, folio, header] = pm;
      const v = pageVars(header);
      const existing = pages.get(folio);
      pages.set(folio, {
        folio,
        ord: existing?.ord ?? pageOrd++,
        quire: v.Q,
        panel: v.P,
        illustration: v.I,
        language: v.L,
        hand: v.H,
        header: header.trim(),
      });
    }
  }

  // Une seule lecture par locus : transcripteur préféré sinon la première rencontrée.
  const lines: ParsedLine[] = [];
  for (const variants of byLocus.values()) {
    const chosen = variants.find((v) => v.transcriber === preferredTranscriber) ?? variants[0];
    if (chosen.text) lines.push(chosen);
  }
  lines.sort((a, b) => a.ord - b.ord);

  return { pages: [...pages.values()].sort((a, b) => a.ord - b.ord), lines, transcribers: [...transcribers].sort() };
}

export const ILLUSTRATION_LABELS: Record<string, string> = {
  A: 'Astronomique',
  B: 'Biologique (balnéologique)',
  C: 'Cosmologique',
  H: 'Herbier',
  P: 'Pharmaceutique',
  S: 'Recettes (étoiles)',
  T: 'Texte seul',
  Z: 'Zodiaque',
};
