import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CharNgramModel } from './ngram.js';
import { fingerprint } from './fingerprint.js';
import { sukhotin, wordStructure } from './algorithms.js';
import { generate } from './generators.js';
import { glyphUnits, normalizeText, rng } from './text.js';
import { folioFromLabel } from './iiif.js';
import { runSandbox } from './sandbox.js';
import { anneal } from './anneal.js';
import { evaluateDecipherment } from './evaluate.js';
import { importRefFromText, generateRef, tokensFor } from './sources.js';

// Petit texte français (domaine public : extrait adapté de La Fontaine) répété pour les statistiques.
const FR = normalizeText(
  `Maître corbeau sur un arbre perché tenait en son bec un fromage. Maître renard par l'odeur alléché lui tint à peu près ce langage :
  hé bonjour monsieur du corbeau que vous êtes joli que vous me semblez beau sans mentir si votre ramage se rapporte à votre plumage
  vous êtes le phénix des hôtes de ces bois. À ces mots le corbeau ne se sent pas de joie et pour montrer sa belle voix il ouvre un large bec
  laisse tomber sa proie. Le renard s'en saisit et dit mon bon monsieur apprenez que tout flatteur vit aux dépens de celui qui l'écoute
  cette leçon vaut bien un fromage sans doute. Le corbeau honteux et confus jura mais un peu tard qu'on ne l'y prendrait plus.
  La cigale ayant chanté tout l'été se trouva fort dépourvue quand la bise fut venue pas un seul petit morceau de mouche ou de vermisseau
  elle alla crier famine chez la fourmi sa voisine la priant de lui prêter quelque grain pour subsister jusqu'à la saison nouvelle.`,
  { stripDiacritics: true },
);
const FR_LONG = Array.from({ length: 12 }, () => FR).join(' ');

test('le modèle n-gramme préfère la langue sur laquelle il est entraîné', () => {
  const lm = CharNgramModel.fromText(FR_LONG, 3);
  const fr = lm.crossEntropy('le renard dit bonjour au corbeau');
  const noise = lm.crossEntropy('xqz kvw pjq zzx wqk');
  assert.ok(fr < noise - 2, `${fr} vs ${noise}`);
});

test('empreinte : mesures cohérentes', () => {
  const fp = fingerprint(FR_LONG.split(' '));
  assert.ok(fp.h1 > 3 && fp.h1 < 5);
  assert.ok(fp.h2 < fp.h1);
  assert.ok(fp.zipfSlope < 0);
  assert.equal(fp.wordLengths.length, 16);
});

test('Sukhotin retrouve les voyelles d’un texte français', () => {
  const r = sukhotin(FR_LONG.split(' '));
  const vowels = new Set(r.vowels.map((v) => v.symbol));
  for (const v of ['a', 'e', 'o', 'i', 'u']) assert.ok(vowels.has(v), `voyelle ${v} manquante : ${[...vowels].join('')}`);
  assert.ok(!vowels.has('t') && !vowels.has('r'));
});

test('unités EVA groupées et structure des mots', () => {
  assert.deepEqual(glyphUnits('qokeedy', 'eva-grouped'), ['q', 'o', 'k', 'ee', 'd', 'y']);
  assert.deepEqual(glyphUnits('chckhy', 'eva-grouped'), ['ch', 'ckh', 'y']);
  const ws = wordStructure(['qokedy', 'qokain', 'chedy', 'shedy', 'daiin'], 'eva-grouped');
  assert.ok(ws.topPrefixes.length > 0);
});

test('générateurs reproductibles avec la même graine', () => {
  const a = generate('timm_autocopy', { voynichTokens: ['daiin', 'chol', 'shedy'], length: 300, seed: 5 });
  const b = generate('timm_autocopy', { voynichTokens: ['daiin', 'chol', 'shedy'], length: 300, seed: 5 });
  assert.deepEqual(a, b);
  assert.ok(a.every((w) => w.length <= 10));
  const r = rng(1);
  assert.notEqual(r(), r());
});

test('libellés IIIF → folios', () => {
  assert.equal(folioFromLabel('1r'), 'f1r');
  assert.equal(folioFromLabel('f. 67r1'), 'f67r1');
  assert.equal(folioFromLabel('Folio 102v2'), 'f102v2');
  assert.equal(folioFromLabel('Front cover'), null);
});

test('bac à sable isolé et borné', async () => {
  const ok = await runSandbox('return 1 + 1');
  assert.equal(ok.value, '2');
  const iso = await runSandbox('return [typeof require, typeof process, typeof fetch].join()');
  assert.equal(iso.value, '"undefined,undefined,undefined"');
  const loop = await runSandbox('for(;;){}', { timeoutMs: 300 });
  assert.equal(loop.ok, false);
});

test('recherche de clé + juge : retrouvent un chiffre de substitution simple', () => {
  const refId = importRefFromText(FR_LONG, { name: 'fr-test' });
  const cipherId = generateRef('simple_substitution', { sourceRefId: refId, seed: 11 });
  const tokens = tokensFor(`ref:${cipherId}`).tokens;
  const r = anneal({ tokens, languageRefId: refId, iterations: 8000, restarts: 2, maxWords: 600, seed: 3 });
  assert.ok(r.signalGap !== null && r.signalGap > 0.5, `écart ${r.signalGap}`);
  const e = evaluateDecipherment({ mapping: r.mapping, source: `ref:${cipherId}`, languageRefId: refId, baselineRuns: 40 });
  assert.ok(e.result.dictionaryRate > 0.6, `dico ${e.result.dictionaryRate}`);
  assert.equal(e.verdict, 'pass');
  // Une table absurde échoue.
  const bad = evaluateDecipherment({ mapping: { a: 'z', b: 'q' }, source: `ref:${cipherId}`, languageRefId: refId, baselineRuns: 20 });
  assert.notEqual(bad.verdict, 'pass');
});
