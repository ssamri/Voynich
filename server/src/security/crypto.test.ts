import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decrypt, encrypt, hashPassword, verifyPassword } from './crypto.js';

test('chiffrement AES-GCM aller-retour et détection de falsification', () => {
  const enc = encrypt('sk-test-123');
  assert.notEqual(enc, encrypt('sk-test-123'));
  assert.equal(decrypt(enc), 'sk-test-123');
  const parts = enc.split('.');
  parts[3] = Buffer.from('xxxx').toString('base64url');
  assert.throws(() => decrypt(parts.join('.')));
});

test('hachage scrypt des mots de passe', async () => {
  const h = await hashPassword('correct horse battery');
  assert.equal(await verifyPassword('correct horse battery', h), true);
  assert.equal(await verifyPassword('mauvais', h), false);
});
