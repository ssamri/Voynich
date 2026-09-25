import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanIvtffText, parseIvtff } from './ivtff.js';

// Données synthétiques au format IVTFF (ce n'est pas un extrait réel du manuscrit).
const SAMPLE = `#=IVTFF Eva- 2.0 M 5
# commentaire
<f1r>      <! $Q=A $P=A $I=H $L=A $H=1>
<f1r.1,@P0;H>     <%>qokal.dar.[a:o]iin,shey<->otol
<f1r.1,@P0;C>     qokal.dar.oiin.shey.otol
<f1r.2,+P0;H>     cho{ch}.s?or.@130;y<$>
<f1v>      <! $I=T $L=B $H=2>
<f1v.1,@P0>       dal.<!commentaire>okar
`;

test('cleanIvtffText normalise les séparateurs et balises', () => {
  assert.equal(cleanIvtffText('<%>qokal.dar.[a:o]iin,shey<->otol'), 'qokal dar aiin shey otol');
  assert.equal(cleanIvtffText('cho{ch}.s?or.@130;y<$>'), 'choch s?or ?y');
});

test('parseIvtff lit pages, métadonnées et choisit le transcripteur préféré', () => {
  const r = parseIvtff(SAMPLE, 'H');
  assert.equal(r.pages.length, 2);
  assert.deepEqual(r.pages[0], { folio: 'f1r', ord: 0, quire: 'A', panel: 'A', illustration: 'H', language: 'A', hand: '1', header: '<! $Q=A $P=A $I=H $L=A $H=1>' });
  assert.equal(r.pages[1].language, 'B');
  assert.deepEqual(r.transcribers, ['C', 'H']);
  assert.equal(r.lines.length, 3);
  assert.equal(r.lines[0].transcriber, 'H');
  assert.equal(r.lines[0].text, 'qokal dar aiin shey otol');
  assert.equal(r.lines[2].text, 'dal okar');

  const c = parseIvtff(SAMPLE, 'C');
  assert.equal(c.lines[0].text, 'qokal dar oiin shey otol');
});
