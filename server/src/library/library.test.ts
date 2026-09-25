import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkText } from './library.js';

test('chunkText couvre tout le texte avec recouvrement', () => {
  const text = Array.from({ length: 60 }, (_, i) => `Paragraphe ${i}. ${'lorem ipsum '.repeat(20)}`).join('\n\n');
  const chunks = chunkText(text, 1000, 100);
  assert.ok(chunks.length > 5);
  assert.ok(chunks.every((c) => c.content.length <= 1000));
  assert.ok(chunks[chunks.length - 1].content.endsWith(text.trim().slice(-20)));
});
