# Voynich Lab

Laboratoire **multi-agents** pour étudier et tenter de déchiffrer le manuscrit de Voynich (Beinecke MS 408).
Depuis un back-office sécurisé, vous connectez **Claude**, **ChatGPT** et tout fournisseur compatible OpenAI.
Vous configurez des agents avec un rôle chacun, puis vous les faites collaborer. Ils partagent un corpus EVA
instrumenté, une bibliothèque documentaire et une mémoire de recherche commune.

## Fonctionnalités

| Module | Contenu |
|---|---|
| **Connexions IA** | Anthropic (Claude), OpenAI (ChatGPT), et tout fournisseur compatible OpenAI (Mistral, DeepSeek, Gemini, Groq, OpenRouter, Ollama…). Les clés sont chiffrées en AES-256-GCM et jamais renvoyées au navigateur. Un bouton teste la connexion en listant les modèles. |
| **Agents** | Nom, modèle, rôle, instructions, effort de raisonnement, tokens, température, couleur, outils autorisés et recherche web (Claude). Cinq rôles types sont fournis : cryptanalyste, linguiste historien, critique méthodologique, historien des sciences, directeur de recherche. Un bouton crée l'« équipe recommandée ». |
| **Séances** | *Table ronde* (chaque agent parle à son tour et réagit aux autres) ou *dirigée* (un directeur délègue via `ask_agent`). Le streaming est en temps réel (SSE), avec les appels d'outils visibles et le raisonnement résumé. Le chercheur peut intervenir à tout moment ou arrêter la séance. On peut demander une synthèse et exporter la séance en Markdown. |
| **Corpus EVA** | Import d'une transcription IVTFF (URL ou fichier) avec choix du transcripteur. Navigation par folio (section, langue de Currier, main). Statistiques : tokens/types, entropies h0/h1/h2, Zipf, longueurs, n-grammes, distribution positionnelle. Également : comparaison de sous-corpus (A vs B), recherche par regex, bac à sable de substitution. |
| **Bibliothèque** | PDF, texte, Markdown, CSV, JSON et images de folios. Recherche plein texte BM25 (SQLite FTS5). On peut joindre des documents à une séance ; les images sont transmises aux modèles multimodaux. |
| **Mémoire** | Carnet de laboratoire partagé : hypothèses, découvertes, faits, impasses, glossaire, questions, plans. Chaque élément a une confiance et un statut (active, confirmée, réfutée, archivée). Les éléments épinglés sont rappelés à chaque tour ; les autres sont retrouvés par pertinence. Export en Markdown. |
| **Sécurité** | Compte administrateur unique, scrypt, cookie httpOnly et SameSite=Strict, sessions révocables. Protection CSRF, CSP/Helmet, limitation des tentatives de connexion, journal d'audit. |

### Outils à disposition des agents

`search_library`, `read_document`, `search_memory`, `save_memory`, `update_memory`, `corpus_info`,
`corpus_get_folio`, `corpus_search`, `corpus_stats`, `apply_substitution`, `ask_agent`, et `web_search` (Claude).

Chaque agent reçoit un brief commun : contexte scientifique, hypothèses historiques et exigences de
méthode (tests, réfutabilité, niveau de confiance). S'y ajoutent son rôle, la composition de l'équipe
et la mémoire pertinente.

## Architecture

```
client/   React 19 + Vite + Tailwind CSS 4 (SPA, chargement à la demande des pages)
server/   Node.js + Express 5 + TypeScript, SQLite (better-sqlite3, WAL, FTS5)
  src/llm/            adaptateurs Anthropic / OpenAI (boucle d'outils en streaming)
  src/orchestrator/   séances, tours de parole, délégation, outils, flux SSE
  src/voynich/        parseur IVTFF + moteur statistique (avec cache)
  src/library/        ingestion (PDF via unpdf), découpage, index plein texte
```

Pour ajouter un fournisseur, écrivez un adaptateur qui implémente `LLMProvider` (`server/src/llm/types.ts`),
puis ajoutez une entrée dans `PROVIDER_KINDS` (`server/src/llm/registry.ts`).

Côté Claude, l'application utilise la réflexion adaptative, le paramètre `effort`, le cache de prompt
et le streaming des entrées d'outils. Pour Claude Opus 5 et Fable, elle active aussi le repli serveur
`fallbacks: "default"`, qui relance automatiquement une requête refusée sur un modèle de secours.
Côté OpenAI, elle passe par l'API Chat Completions avec `reasoning_effort` pour les modèles de
raisonnement.

## Démarrage

Prérequis : Node.js ≥ 20.19.

```bash
npm install
cp .env.example server/.env        # puis renseignez APP_SECRET (obligatoire en production)
npm run dev                        # API sur :8787, interface sur http://localhost:5173
```

1. Créez le compte administrateur (premier écran).
2. **Connexions IA** : ajoutez votre clé Anthropic et votre clé OpenAI.
3. **Agents** : cliquez sur « Équipe recommandée » ou composez votre équipe.
4. **Corpus EVA → Import** : importez une translittération IVTFF, par exemple celles publiées par
   R. Zandbergen sur voynich.nu (vérifiez leurs conditions d'utilisation).
5. **Bibliothèque** : déposez articles, notes et images de folios.
6. **Séances** : fixez un objectif et lancez les agents.

### Production

```bash
npm run build
APP_SECRET=... SETUP_TOKEN=... npm start       # sert l'API et l'interface sur le port 8787
```

Ou avec Docker :

```bash
docker build -t voynich-lab .
docker run -d -p 127.0.0.1:8787:8787 -v voynich-data:/data \
  -e APP_SECRET=... -e SETUP_TOKEN=... -e TRUST_PROXY=1 voynich-lab
```

Placez un reverse-proxy HTTPS (Caddy, Nginx) devant. En production, le cookie de session est `Secure`.
Sauvegardez le volume de données : il contient la base SQLite et les fichiers téléversés.
**Ne perdez pas `APP_SECRET`** : sans lui, les clés API enregistrées ne peuvent plus être déchiffrées.

## Tests

```bash
npm test          # parseur IVTFF, statistiques, chiffrement, découpage des documents
npm run typecheck
```
