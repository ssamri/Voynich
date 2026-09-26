# Voynich Lab — Plan du projet

> Application web où **une équipe mixte** — vous et plusieurs agents IA (Claude, ChatGPT, puis d'autres) —
> travaille ensemble au déchiffrement du manuscrit de Voynich (Beinecke MS 408).
> Ce document décrit **ce que l'on va construire et dans quel ordre**. Il sert de référence avant tout développement.

---

## 1. Vision

- Une **salle de travail partagée** : une conversation en temps réel entre vous et les agents. Vous y écrivez,
  envoyez des fichiers, orientez la recherche, corrigez une piste ou apportez un indice, exactement comme dans
  une équipe humaine.
- Des **agents spécialisés** (cryptanalyste, linguiste, critique…) connectés à différents fournisseurs d'IA,
  chacun avec un rôle clair, qui se répondent, se consultent et testent leurs hypothèses.
- Une **mémoire de recherche** et une **bibliothèque** communes, pour ne jamais refaire une impasse et capitaliser
  sur chaque découverte.
- Des **outils d'analyse du corpus EVA** (transcription du manuscrit) utilisables par vous comme par les agents.

---

## 2. Choix techniques

| Couche | Choix | Rôle |
|---|---|---|
| Interface | **React + Vite + Tailwind CSS** (TypeScript) | Back-office, salle de travail, thèmes clair/sombre |
| Base de données | **Supabase — projet `Voynich`** (`ameczdueixnloinvavpl`, Postgres 17, eu-west-1) | Toutes les données du projet |
| Authentification | **Supabase Auth** (e-mail + mot de passe, inscriptions fermées, sur invitation) | Accès sécurisé au back-office |
| Temps réel | **Supabase Realtime** (Postgres Changes + Broadcast) | Messages en direct, texte des agents qui s'écrit en streaming, présence |
| Fichiers | **Supabase Storage** (buckets privés, URL signées) | Pièces jointes, PDF, images de folios |
| Secrets | **Supabase Vault** | Clés API Claude / OpenAI chiffrées, jamais exposées au navigateur |
| Recherche | Postgres plein texte (`unaccent`) + **pgvector** (recherche sémantique) | Bibliothèque et mémoire |
| Orchestrateur d'agents | **Service Node.js (TypeScript)** — le « worker » | Appelle Claude / OpenAI, exécute les outils, écrit dans Supabase |

**Pourquoi un worker Node plutôt que des Edge Functions ?** Une séance multi-agents peut durer plusieurs minutes
(plusieurs tours, appels d'outils, réflexion longue). Un service dédié n'a pas de limite de durée, garde les
connexions de streaming ouvertes et se déploie facilement (Railway, Fly.io, Render, VPS ou Docker). Les Edge
Functions resteront possibles pour de petites tâches (ex. extraction de texte d'un PDF à l'upload).

### Flux temps réel

```
 Vous (navigateur)                    Supabase                         Worker Node
 ─────────────────                    ────────                         ───────────
 écrit un message + fichier ──► insert messages / upload Storage
                                       │  (Postgres Changes)
                                       └──────────────────────────────► détecte le nouveau message
                                                                        choisit l'agent qui répond
                                                                        appelle Claude / OpenAI (streaming)
 voit le texte s'écrire  ◄──── Broadcast canal "room:<id>" ◄────────── diffuse les morceaux de texte
 voit les outils utilisés ◄─── Broadcast                    ◄────────── outil appelé / résultat
 voit le message final   ◄──── Postgres Changes ◄──────────────────── insert message final + usage
```

---

## 3. Fonctionnalités

### 3.1 Salle de travail (conversation d'équipe) — cœur de l'application

- **Fil de discussion partagé** entre vous et les agents, mis à jour en temps réel, avec l'historique complet.
- **Vous êtes un membre de l'équipe à part entière** :
  - écrire à tout moment, y compris pendant qu'un agent rédige ;
  - **mentionner** un agent (`@Claude`, `@GPT`) pour lui adresser une question ou une consigne ;
  - **joindre des fichiers** (glisser-déposer ou coller) : images de folios, PDF, notes, tableaux, fichiers texte.
    Chaque fichier est stocké, indexé dans la bibliothèque et **transmis aux agents** (les images sont vues par les
    modèles, le texte des PDF est extrait) ;
  - **répondre à un message précis** (citation) et **épingler** un message important ;
  - transformer un message en **élément de mémoire** (hypothèse, découverte, impasse…) en un clic.
- **Pilotage de la séance** :
  - *Mode conversation* : les agents répondent quand vous écrivez ou quand on les mentionne ;
  - *Mode table ronde* : les agents enchaînent N tours, chacun réagissant aux autres ;
  - *Mode dirigé* : un agent « directeur de recherche » répartit le travail entre les spécialistes ;
  - boutons **Lancer / Pause / Reprendre / Arrêter**, nombre de tours, choix de l'agent qui parle ensuite ;
  - les agents peuvent **vous poser une question** et attendre votre réponse avant de continuer.
- **Transparence** : pour chaque réponse d'agent, on voit le modèle, les outils utilisés (entrée et résultat),
  le raisonnement résumé, les tokens consommés et la durée.
- **Plusieurs salles** (une par axe de recherche) avec objectif, participants et documents de contexte.
- **Synthèse** à la demande et **export** (Markdown / PDF) d'une séance.

### 3.2 Connexions IA (fournisseurs)

- Claude (Anthropic) et ChatGPT (OpenAI) au lancement ; architecture ouverte pour ajouter ensuite Mistral,
  Gemini, DeepSeek, Ollama, etc. (tout fournisseur compatible OpenAI).
- Clés API saisies une fois, **stockées dans Supabase Vault**, lues uniquement par le worker.
- Bouton « Tester la connexion » et liste des modèles disponibles.

### 3.3 Agents

- Nom, avatar/couleur, fournisseur, modèle, **rôle** et instructions, niveau de réflexion, limite de tokens,
  outils autorisés.
- Rôles prêts à l'emploi : **Cryptanalyste**, **Linguiste historien**, **Critique méthodologique**,
  **Historien des sciences**, **Directeur de recherche**.
- Brief commun à tous les agents : contexte scientifique du manuscrit, hypothèses connues, exigences de méthode
  (tests, réfutabilité, niveau de confiance, collaboration).

### 3.4 Outils des agents

Les deux agents (Claude et ChatGPT) ont accès **à la bibliothèque interne, à la mémoire partagée et à la recherche internet**. Consigne donnée aux agents : consulter d'abord la mémoire et la bibliothèque, puis compléter sur internet, citer leurs sources et consigner les acquis dans la mémoire.


| Outil | Usage |
|---|---|
| `search_library` / `read_document` | Chercher et lire dans la bibliothèque |
| `search_memory` / `save_memory` / `update_memory` | Consulter et enrichir la mémoire partagée |
| `corpus_get_folio` / `corpus_search` / `corpus_stats` | Lire un folio, chercher un mot ou motif, statistiques |
| `apply_substitution` | Tester une table de déchiffrement sur un folio |
| `ask_agent` | Consulter un autre agent |
| `ask_human` | Vous poser une question et attendre la réponse |
| `web_search` | **Recherche internet** — native chez Claude et chez ChatGPT, sources citées en fin de réponse |
| `web_fetch` | Lecture complète d'une page web (Claude) |

### 3.5 Mémoire partagée

- Types : hypothèse, découverte, fait établi, impasse, glossaire, question ouverte, plan.
- Niveau de confiance, statut (active, confirmée, réfutée, archivée), auteur (vous ou un agent), lien vers le
  message d'origine.
- Éléments **épinglés** rappelés aux agents à chaque tour ; les autres retrouvés par pertinence (plein texte +
  sémantique).
- Vue tableau / cartes, filtres, historique des modifications, export.

### 3.6 Bibliothèque

- PDF, textes, Markdown, CSV, images (folios haute résolution), liens.
- Extraction du texte, découpage et indexation (plein texte + embeddings pgvector).
- Étiquettes, notes, aperçu, rattachement d'un document à une salle.

### 3.7 Corpus EVA et analyse

- Import d'une transcription au format IVTFF (ex. Zandbergen-Landini, Takahashi) — par URL ou fichier.
- Navigation par folio avec métadonnées : section illustrée, langue de Currier (A/B), main du scribe.
- Statistiques : fréquences, entropies h0/h1/h2, loi de Zipf, longueur des mots, n-grammes, position des glyphes
  dans le mot, comparaison de sous-corpus.
- Recherche par mot ou expression régulière, bac à sable de substitution.
- (Plus tard) visionneuse d'images de folios avec annotations liées aux lignes de transcription.

### 3.8 Tableau de bord

- Avancement (hypothèses actives / confirmées / réfutées), dernières découvertes, salles actives.
- Consommation de tokens par agent et par fournisseur.

---

## 4. Interface et design

- **Mode clair et mode sombre**, avec un bouton de bascule et le choix « suivre le système » (préférence mémorisée).
- **Couleur principale : bleu doux.** Palette de départ :

| Rôle | Mode clair | Mode sombre |
|---|---|---|
| Principale (bleu doux) | `#5B8DEF` | `#7BA4F4` |
| Principale — survol | `#4A7BDC` | `#93B6F7` |
| Principale — fond léger | `#EAF1FE` | `#1C2A44` |
| Fond de page | `#F7F9FC` | `#0F1420` |
| Surface (cartes) | `#FFFFFF` | `#171E2E` |
| Bordures | `#E2E8F0` | `#273248` |
| Texte principal | `#1A2233` | `#E6EBF5` |
| Texte secondaire | `#5B6679` | `#98A3B8` |
| Succès / Alerte / Erreur | `#2F9E77` / `#D99A2B` / `#D9534F` | `#4CC49A` / `#E8B04E` / `#EF6F6B` |

- Couleurs définies comme variables CSS (tokens Tailwind), pour pouvoir ajuster la teinte de bleu sans toucher
  aux composants. Chaque agent garde sa propre couleur d'avatar, lisible dans les deux thèmes.
- Typographie sobre et lisible (Inter pour l'interface, police à chasse fixe pour le texte EVA).
- Responsive : utilisable sur ordinateur, tablette et téléphone (la salle de travail en priorité).

---

## 5. Modèle de données Supabase (schéma `public`)

| Table | Contenu principal |
|---|---|
| `profiles` | Utilisateurs humains (lié à `auth.users`) : nom affiché, avatar, rôle (admin / membre) |
| `providers` | Fournisseurs IA : type, nom, URL, modèle par défaut, **référence** vers le secret dans Vault |
| `agents` | Agents : fournisseur, modèle, rôle, instructions, couleur, outils, paramètres |
| `rooms` | Salles de travail : titre, objectif, mode, statut (inactive, en cours, en pause), directeur |
| `room_members` | Participants d'une salle (humains et agents), ordre de parole |
| `messages` | Messages : auteur (humain ou agent), contenu, réponse à, mentions, épinglé, usage tokens, erreur |
| `message_attachments` | Fichiers joints à un message → objet Storage + document de bibliothèque |
| `tool_calls` | Appels d'outils d'un message d'agent : outil, entrée, résultat, durée |
| `runs` | Exécutions d'agents : salle, mode, tours demandés, statut, début/fin (pilotage pause/arrêt) |
| `documents` | Bibliothèque : titre, type, fichier Storage, texte extrait, étiquettes, notes |
| `document_chunks` | Morceaux indexés : texte, `tsvector`, `embedding vector` |
| `memories` | Mémoire : type, titre, contenu, confiance, statut, épinglé, auteur, message d'origine |
| `memory_events` | Historique des modifications de la mémoire |
| `corpus_pages` / `corpus_lines` | Transcription EVA : folios, métadonnées, lignes |
| `audit_log` | Journal des actions sensibles |

**Storage** : buckets privés `attachments` et `library` (accès par URL signées).

**Sécurité (RLS)** :
- Row Level Security activé sur **toutes** les tables ; accès réservé aux utilisateurs authentifiés membres du projet.
- Les clés API ne sont lisibles que par le worker (clé `service_role`, jamais envoyée au navigateur).
- Inscriptions publiques désactivées : comptes créés par invitation.

---

## 6. Plan de réalisation

### Phase 1 — Fondations
- [ ] Schéma Supabase (migrations SQL versionnées dans `supabase/migrations`), RLS, buckets Storage
- [ ] Authentification Supabase (connexion, invitation, déconnexion)
- [x] **Thèmes clair/sombre** (bouton clair / sombre / système) et palette bleu doux — déjà appliqués au prototype
- [ ] Squelette React : navigation, composants de base

### Phase 2 — Fournisseurs et agents
- [ ] Gestion des fournisseurs (clés dans Vault, test de connexion, liste des modèles)
- [ ] Gestion des agents et rôles prêts à l'emploi
- [x] Adaptateurs Claude (Messages API) et OpenAI (Responses API) en streaming, avec appels d'outils et recherche internet native — déjà dans le prototype
- [ ] Worker Node branché sur Supabase

### Phase 3 — Salle de travail en équipe (priorité)
- [ ] Fil de discussion temps réel (Realtime), messages humains et agents
- [ ] Envoi de fichiers (glisser-déposer, coller), aperçus, transmission aux agents
- [ ] Mentions `@agent`, réponses citées, épinglage, message → mémoire
- [ ] Streaming du texte des agents + affichage des outils utilisés
- [ ] Modes conversation / table ronde / dirigé ; Lancer, Pause, Reprendre, Arrêter
- [ ] Outil `ask_human` (l'agent attend votre réponse)

### Phase 4 — Connaissance partagée
- [ ] Bibliothèque : upload, extraction de texte (PDF), indexation plein texte + pgvector
- [ ] Mémoire partagée : CRUD, confiance, statuts, épinglage, historique, injection dans le contexte des agents

### Phase 5 — Corpus EVA
- [ ] Import IVTFF, navigation par folio
- [ ] Statistiques, recherche, comparaison, bac à sable de substitution
- [ ] Outils corpus pour les agents

### Phase 6 — Finitions
- [ ] Tableau de bord, consommation de tokens
- [ ] Synthèse et export des séances
- [ ] Tests, déploiement (front + worker), documentation d'installation

---

## 7. Points à valider

1. **Utilisateurs** : êtes-vous seul à utiliser l'application, ou faut-il prévoir d'autres membres humains
   (collaborateurs invités) ?
2. **Hébergement du worker** : préférence entre Railway, Fly.io, Render, un VPS, ou autre ?
3. **Hébergement du front** : Vercel, Netlify, ou le même serveur que le worker ?
4. **Transcription EVA** : quelle source souhaitez-vous utiliser en priorité (ex. Zandbergen-Landini) ?
5. **Budget IA** : faut-il un plafond de tokens / coût par séance ou par jour ?

---

## 8. État actuel du dépôt

Un premier prototype (serveur Express + SQLite, front React) existe déjà dans `server/` et `client/`.
Il couvre une partie des fonctionnalités ci-dessus (agents, orchestrateur, corpus, bibliothèque, mémoire). Il sera
**migré vers Supabase** et adapté à ce plan (thème bleu doux clair/sombre, salle de travail collaborative avec
fichiers) à partir de la phase 1. Le code réutilisable (adaptateurs IA, parseur IVTFF, statistiques) sera conservé.
