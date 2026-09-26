// Point d'entrée conventionnel pour les hébergeurs (Hostinger, Passenger…).
// - Si dist/ est absent (hébergeur qui n'exécute pas le build), on compile au premier démarrage.
// - Si le démarrage échoue malgré tout, un mini-serveur affiche la cause au lieu d'un 503 muet.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, 'dist', 'index.js');
let buildLog = '';

function ensureBuilt() {
  if (fs.existsSync(entry) && fs.existsSync(path.join(here, 'dist', 'public', 'index.html'))) return;
  console.log('[voynich] dist/ absent : compilation au démarrage…');
  // npm n'est pas forcément dans le PATH à l'exécution : on appelle les outils directement avec Node.
  const bin = (rel) => path.join(here, 'node_modules', rel);
  const run = (script, args, cwd) => {
    if (!fs.existsSync(script)) throw new Error(`outil de compilation introuvable : ${path.relative(here, script)} (dépendances non installées ?)`);
    execFileSync(process.execPath, [script, ...args], { cwd, stdio: 'pipe', timeout: 600_000 });
  };
  try {
    run(bin('vite/bin/vite.js'), ['build'], path.join(here, 'client'));
    run(bin('typescript/bin/tsc'), ['-p', 'tsconfig.json'], path.join(here, 'server'));
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
