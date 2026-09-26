// Point d'entrée conventionnel pour les hébergeurs (Hostinger, Passenger…).
// - Si dist/ est absent (hébergeur qui n'exécute pas le build), on compile au premier démarrage.
// - Si le démarrage échoue malgré tout, un mini-serveur affiche la cause au lieu d'un 503 muet.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, 'dist', 'index.js');
let buildLog = '';

function ensureBuilt() {
  if (fs.existsSync(entry) && fs.existsSync(path.join(here, 'dist', 'public', 'index.html'))) return;
  console.log('[voynich] dist/ absent : compilation au démarrage…');
  try {
    if (!fs.existsSync(path.join(here, 'node_modules', 'vite'))) {
      execSync('npm install --include=dev --no-audit --no-fund', { cwd: here, stdio: 'pipe', timeout: 600_000 });
    }
    execSync('npm run build', { cwd: here, stdio: 'pipe', timeout: 600_000 });
  } catch (err) {
    buildLog = `${err?.stdout ?? ''}${err?.stderr ?? ''}`.slice(-4000);
    throw new Error(`échec de la compilation : ${err?.message ?? err}`);
  }
}

function showError(err) {
  console.error('[voynich] échec du démarrage :', err, buildLog);
  let listing = '';
  try { listing = fs.readdirSync(here).join(', '); } catch { /* ignoré */ }
  const port = /^\d+$/.test(process.env.PORT ?? '') ? Number(process.env.PORT) : (process.env.PORT ?? 8787);
  const text = `Voynich Lab n'a pas pu démarrer.\n\nCause : ${err?.message ?? err}\n\nNode ${process.version} — dossier ${here}\nContenu : ${listing}\n${buildLog ? `\nJournal de compilation :\n${buildLog}\n` : ''}`;
  http
    .createServer((_req, res) => {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(text);
    })
    .listen(port);
}

try {
  ensureBuilt();
  import('./dist/index.js').catch(showError);
} catch (err) {
  showError(err);
}
