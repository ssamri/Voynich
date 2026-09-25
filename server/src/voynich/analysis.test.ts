import { test } from 'node:test';
import assert from 'node:assert/strict';
import { characterEntropy, substitute, wordsOf } from './analysis.js';

test('substitute privilégie les séquences les plus longues', () => {
  const r = substitute('chol daiin', { ch: 'K', c: 'x', o: 'a', aiin: 'um', d: 'd' });
  assert.equal(r.output, 'Kal dum');
  assert.deepEqual(r.unmapped, { l: 1 });
});

test('wordsOf ignore les mots illisibles', () => {
  assert.deepEqual(wordsOf([{ text: 'dal s?or okar' }]), ['dal', 'okar']);
  assert.deepEqual(wordsOf([{ text: 'dal s?or' }], false), ['dal', 's?or']);
});

test('characterEntropy : texte uniforme sur 2 symboles alternés', () => {
  const e = characterEntropy('abababababababab');
  assert.equal(e.alphabet, 2);
  assert.ok(Math.abs(e.h1 - 1) < 1e-9);
  assert.ok(e.h2 < 0.01); // parfaitement prévisible
});
