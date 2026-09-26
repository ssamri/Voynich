// Copie dist/ vers release/ (versionné) : certains hébergeurs (Hostinger) ne gardent pas dist/ à l'exécution
// et ne peuvent pas compiler au démarrage. server.js utilise release/ si dist/ est absent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'dist');
const dest = path.join(root, 'release');
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true, filter: (f) => !f.endsWith('.map') });
console.log(`[release] ${path.relative(root, src)} → ${path.relative(root, dest)}`);
