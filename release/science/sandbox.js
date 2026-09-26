import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten';
import { allCorpusLines } from '../voynich/analysis.js';
import { getRef } from './sources.js';
import { tokensOf } from './text.js';
/**
 * Bac à sable de calcul : les agents écrivent du JavaScript exécuté dans QuickJS (WebAssembly),
 * isolé du serveur (pas de réseau, pas de fichiers), avec limites de temps et de mémoire.
 * Données disponibles : VOYNICH (lignes du corpus) et REFS (corpus de référence demandés).
 */
let qjs = null;
const PRELUDE = `
const __out = [];
const __fmt = (v) => typeof v === 'string' ? v : JSON.stringify(v);
const console = { log: (...a) => __out.push(a.map(__fmt).join(' ')), error: (...a) => __out.push('[erreur] ' + a.map(__fmt).join(' ')) };
/** Lignes filtrées : { section, language, hand, folios } */
function lines(f = {}) {
  return VOYNICH.filter((l) => (!f.section || l.section === f.section) && (!f.language || l.language === f.language) && (!f.hand || l.hand === f.hand) && (!f.folios || f.folios.includes(l.folio)));
}
/** Mots EVA (sans les mots illisibles) */
function words(f = {}) { return lines(f).flatMap((l) => l.text.split(' ').filter((w) => w && !/[?*]/.test(w))); }
function freq(arr) { const m = {}; for (const x of arr) m[x] = (m[x] || 0) + 1; return Object.entries(m).sort((a, b) => b[1] - a[1]); }
function entropy(arr) { const f = freq(arr); const n = arr.length; return -f.reduce((h, [, c]) => h + (c / n) * Math.log2(c / n), 0); }
function refWords(id) { const r = REFS[id]; if (!r) throw new Error('Corpus de référence ' + id + ' non chargé : ajoutez-le à refs'); return r.words; }
`;
export async function runSandbox(code, opts = {}) {
    qjs ??= await getQuickJS();
    const runtime = qjs.newRuntime();
    runtime.setMemoryLimit(256 * 1024 * 1024);
    runtime.setMaxStackSize(1024 * 1024);
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + Math.min(opts.timeoutMs ?? 8000, 15000)));
    const ctx = runtime.newContext();
    const started = Date.now();
    try {
        const voynich = allCorpusLines().map((l) => ({ folio: l.folio, locus: l.locus, text: l.text, section: l.illustration, language: l.language, hand: l.hand }));
        const refs = {};
        for (const id of opts.refs ?? []) {
            const r = getRef(id);
            if (r)
                refs[id] = { name: r.name, language: r.language, words: tokensOf(r.text).slice(0, 60000) };
        }
        const setup = ctx.evalCode(`const VOYNICH = JSON.parse(${JSON.stringify(JSON.stringify(voynich))}); const REFS = JSON.parse(${JSON.stringify(JSON.stringify(refs))});${PRELUDE}`);
        if (setup.error) {
            const e = ctx.dump(setup.error);
            setup.error.dispose();
            throw new Error(`Initialisation : ${JSON.stringify(e)}`);
        }
        setup.value.dispose();
        const res = ctx.evalCode(`(() => { ${code}\n })()`);
        const outHandle = ctx.evalCode('__out.join("\\n")');
        const logs = outHandle.error ? '' : ctx.dump(outHandle.value);
        if (outHandle.error)
            outHandle.error.dispose();
        else
            outHandle.value.dispose();
        if (res.error) {
            const e = ctx.dump(res.error);
            res.error.dispose();
            return { ok: false, logs: logs.slice(0, 20000), error: `${e?.name ?? 'Erreur'} : ${e?.message ?? JSON.stringify(e)}`, durationMs: Date.now() - started };
        }
        const value = ctx.dump(res.value);
        res.value.dispose();
        return { ok: true, logs: logs.slice(0, 20000), value: value === undefined ? null : JSON.stringify(value)?.slice(0, 20000) ?? null, durationMs: Date.now() - started };
    }
    finally {
        ctx.dispose();
        runtime.dispose();
    }
}
//# sourceMappingURL=sandbox.js.map