# Supabase — projet « Voynich »

Migrations du schéma cible (Postgres 17, région eu-west-1), déjà appliquées sur le projet `ameczdueixnloinvavpl`.

| Migration | Contenu |
|---|---|
| `…_foundation` | Profils et rôles (admin / membre / en attente), fournisseurs IA avec clés dans **Supabase Vault**, agents, réglages, audit |
| `…_collaboration_knowledge` | Salles de travail, participants, messages, pièces jointes, appels d'outils, exécutions, campagnes, bibliothèque (plein texte + vecteurs), mémoire et historique, buckets `attachments` / `library`, temps réel |
| `…_science` | Corpus EVA, corpus de référence, journal d'expériences (critères figés), indices, images IIIF, annotations |
| `…_hardening` | Fonctions d'autorisation déplacées dans le schéma `private` (non exposé par l'API) |

## Sécurité
- RLS activé sur toutes les tables. Accès réservé aux comptes dont le profil est `admin` ou `member`.
- Le **premier compte créé devient administrateur** ; les suivants sont « en attente » jusqu'à validation par un administrateur.
- Les clés API sont écrites par `set_provider_api_key()` (administrateurs uniquement) et lues par `get_provider_api_key()`, exécutable **uniquement avec la clé `service_role`** (serveur d'agents), jamais depuis le navigateur.
- Buckets de fichiers privés (URL signées).

## À faire dans le tableau de bord Supabase
- Authentication → Sign In / Providers : **désactiver les inscriptions publiques** (« Allow new users to sign up ») une fois votre compte créé, puis inviter les collaborateurs.

## Appliquer sur un autre projet
```bash
supabase link --project-ref <ref>
supabase db push
```
