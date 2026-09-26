// Point d'entrée conventionnel pour les hébergeurs (Hostinger, Passenger…).
// Si le démarrage échoue, un mini-serveur affiche la cause au lieu d'un 503 muet.
import http from 'node:http';

import('./dist/index.js').catch((err) => {
  console.error('[voynich] échec du démarrage :', err);
  const port = /^\d+$/.test(process.env.PORT ?? '') ? Number(process.env.PORT) : (process.env.PORT ?? 8787);
  const text = `Voynich Lab n'a pas pu démarrer.\n\nCause : ${err?.message ?? err}\n\nNode ${process.version} — dossier ${process.cwd()}\n`;
  http
    .createServer((_req, res) => {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(text);
    })
    .listen(port);
});
