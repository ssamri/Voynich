import { db } from '../db.js';
import { createTextDocument } from '../library/library.js';
import { createMemory } from '../memory.js';
const SEEDS = [
    // ── Faits établis ──
    {
        type: 'fact',
        title: 'Datation du vélin : 1404–1438',
        content: "La datation au carbone 14 de quatre échantillons de vélin (Université d'Arizona, 2009) donne 1404–1438. Elle date le support, pas nécessairement l'écriture, mais une écriture bien plus tardive sur du vélin ancien est jugée peu probable.",
        evidence: '[Hodgins, 2009] — https://www.voynich.nu/',
        confidence: 0.95,
        pinned: true,
        tags: 'datation,matériel',
    },
    {
        type: 'fact',
        title: 'Provenance : de Prague (XVIIe s.) à la Beinecke (MS 408)',
        content: "Une lettre de Johannes Marcus Marci à Athanasius Kircher (années 1660) accompagnait le manuscrit et rapporte un achat attribué à l'empereur Rodolphe II. Une signature effacée de Jacobus Horcicky de Tepenec apparaît sur f1r. Wilfrid Voynich l'acquiert en 1912 auprès des jésuites (Villa Mondragone, près de Frascati). Donné à la Beinecke Library (Yale) par H. P. Kraus en 1969.",
        evidence: '[D’Imperio, 1978] — https://www.voynich.nu/',
        confidence: 0.9,
        tags: 'histoire,provenance',
    },
    {
        type: 'fact',
        title: 'Deux « langues » statistiques A et B (Currier)',
        content: "Prescott Currier a montré que le texte se répartit en deux variétés statistiques (A et B), avec des fréquences de mots et de glyphes différentes, corrélées aux mains des scribes et en partie aux sections. Toute hypothèse doit expliquer cette dualité.",
        evidence: '[Currier, 1976]',
        confidence: 0.9,
        pinned: true,
        tags: 'statistiques,langues',
    },
    {
        type: 'fact',
        title: 'Plusieurs scribes (paléographie)',
        content: "L'analyse paléographique de Lisa Fagin Davis distingue cinq mains, en cohérence avec les langues de Currier. Les différences entre mains sont une variable à contrôler dans toute statistique.",
        evidence: '[Davis, 2020]',
        confidence: 0.8,
        tags: 'paléographie,scribes',
    },
    {
        type: 'fact',
        title: 'Translittération EVA',
        content: "L'alphabet EVA (European Voynich Alphabet, Landini & Zandbergen, 1998) transcrit les traits de plume, pas des lettres : certaines séquences (ch, sh, cth, ckh, iin…) sont probablement un seul signe. Le choix des unités change fortement les statistiques (à tester avec alphabet eva vs eva-grouped).",
        evidence: '[Landini & Zandbergen, 1998] — https://www.voynich.nu/',
        confidence: 0.9,
        tags: 'transcription,EVA',
    },
    {
        type: 'finding',
        title: 'Entropie conditionnelle anormalement basse (à re-mesurer)',
        content: "Depuis Bennett, on rapporte que le texte est beaucoup plus prévisible caractère par caractère (h2 bas) que les langues européennes. À re-mesurer avec compare_fingerprints sur le corpus chargé, en comparant aux langues de référence et aux textes générés, et avec les deux alphabets.",
        evidence: '[Bennett, 1976]',
        confidence: 0.7,
        tags: 'entropie,statistiques',
    },
    {
        type: 'finding',
        title: 'Structure des mots très régulière (grammaire à cases)',
        content: "Les mots obéissent à un ordre interne strict des glyphes (préfixes, noyau à « pieds de table », suffixes), décrit par Stolfi puis formalisé en grammaire à cases. Cette rigidité est inhabituelle pour une orthographe alphabétique. À vérifier avec algo_word_structure.",
        evidence: '[Zattera, 2022] — https://www.ic.unicamp.br/~stolfi/voynich/',
        confidence: 0.75,
        tags: 'morphologie,mots',
    },
    {
        type: 'finding',
        title: 'Mots-clés concentrés par section',
        content: "Montemurro et Zanette observent des mots fortement regroupés dans certaines sections, comme dans un texte porteur de sens. Des textes générés (auto-copie) pourraient produire un effet semblable : à tester avec algo_keywords sur Voynich et sur les corpus générés.",
        evidence: '[Montemurro & Zanette, 2013]',
        confidence: 0.6,
        tags: 'sémantique,sections',
    },
    // ── Impasses connues ──
    {
        type: 'dead_end',
        title: 'Newbold (1921) : micro-sténographie dans les traits',
        content: "William Newbold pensait lire des signes microscopiques dans les traits de plume. John Manly a montré qu'il s'agissait de craquelures de l'encre. Réfuté.",
        evidence: '[Manly, 1931]',
        confidence: 0.05,
        status: 'refuted',
        tags: 'historique,réfuté',
    },
    {
        type: 'dead_end',
        title: 'Feely (1943) : latin abrégé',
        content: "Lecture comme latin médical fortement abrégé. Non reproductible, traductions arbitraires ; rejetée.",
        evidence: "[D’Imperio, 1978]",
        confidence: 0.05,
        status: 'refuted',
        tags: 'historique,latin,réfuté',
    },
    {
        type: 'dead_end',
        title: 'Strong (1945) : chiffre attribué à Anthony Ascham',
        content: "Déchiffrement annoncé vers l'anglais du XVIe siècle ; incompatible avec la datation et non reproductible. Rejeté.",
        evidence: "[D’Imperio, 1978]",
        confidence: 0.05,
        status: 'refuted',
        tags: 'historique,réfuté',
    },
    {
        type: 'dead_end',
        title: 'Levitov (1987) : créole flamand et cathares',
        content: "Traduction supposée d'une langue créole liée à un rite cathare ; la méthode ne tient pas et les traductions sont incohérentes. Rejetée.",
        evidence: '[Levitov, 1987]',
        confidence: 0.05,
        status: 'refuted',
        tags: 'historique,réfuté',
    },
    {
        type: 'dead_end',
        title: 'Gibbs (2017) : abréviations latines médicales',
        content: "Proposition publiée dans le Times Literary Supplement ; rejetée rapidement par les spécialistes (pas de texte latin cohérent obtenu).",
        evidence: '[Gibbs, 2017]',
        confidence: 0.05,
        status: 'refuted',
        tags: 'latin,réfuté',
    },
    {
        type: 'dead_end',
        title: 'Cheshire (2019) : « proto-roman »',
        content: "Lecture d'une langue « proto-romane » ; méthode circulaire et traductions non vérifiables ; l'université d'affiliation s'en est distanciée.",
        evidence: '[Cheshire, 2019]',
        confidence: 0.05,
        status: 'refuted',
        tags: 'roman,réfuté',
    },
    {
        type: 'dead_end',
        title: 'Hauer & Kondrak (2016) : hébreu avec anagrammes',
        content: "Méthode statistique suggérant l'hébreu avec lettres anagrammées ; les « traductions » obtenues sont très pauvres et la méthode trouve des résultats similaires sur d'autres textes. Non retenue — rappel : un score d'optimisation seul ne prouve rien (voir anneal_substitution et son contrôle).",
        evidence: '[Hauer & Kondrak, 2016]',
        confidence: 0.1,
        status: 'refuted',
        tags: 'hébreu,IA,réfuté',
    },
    // ── Hypothèses ouvertes ──
    {
        type: 'hypothesis',
        title: 'Texte généré mécaniquement (canular ou procédé)',
        content: "Tables et grille (Rugg, 2004) ou auto-copie avec modifications (Timm & Schinner, 2020) reproduiraient plusieurs propriétés (structure des mots, répétitions, effets de ligne). À tester : compare_fingerprints contre les corpus rugg_grille et timm_autocopy générés dans le Laboratoire.",
        evidence: '[Rugg, 2004] [Timm & Schinner, 2020]',
        confidence: 0.3,
        tags: 'canular,génération',
    },
    {
        type: 'hypothesis',
        title: 'Langue naturelle notée dans une écriture inventée',
        content: "Le texte noterait une langue réelle (éventuellement peu documentée) avec une écriture propre, peut-être en partie syllabique. Prédit : distributions proches d'une langue naturelle une fois les bonnes unités choisies. Voir la synthèse de Bowern & Lindemann.",
        evidence: '[Bowern & Lindemann, 2021]',
        confidence: 0.3,
        tags: 'langue naturelle',
    },
    {
        type: 'hypothesis',
        title: 'Chiffre « verbeux » (une lettre claire → plusieurs glyphes)',
        content: "Chaque lettre claire serait notée par un groupe de glyphes, ce qui expliquerait la faible entropie et la structure rigide des mots. À tester : générer des chiffres verbeux (Laboratoire) et comparer leurs empreintes à Voynich.",
        evidence: '[Zandbergen, voynich.nu] — https://www.voynich.nu/',
        confidence: 0.25,
        tags: 'chiffre',
    },
    {
        type: 'hypothesis',
        title: 'Lectures partielles de noms de plantes (Bax)',
        content: "Stephen Bax a proposé des lectures de quelques étiquettes (noms de plantes, d'étoiles). Non confirmées : à traiter comme des indices faibles (cribs) et à tester globalement, pas mot à mot.",
        evidence: '[Bax, 2014]',
        confidence: 0.15,
        tags: 'plantes,indices',
    },
    // ── Questions ouvertes ──
    {
        type: 'question',
        title: 'Quelles sont les vraies unités d’écriture ?',
        content: "ch, sh, cth, iin, aiin… sont-ils des signes uniques ? Comparer toutes les analyses avec alphabet « eva » et « eva-grouped » et voir lequel donne des statistiques les plus proches d'une écriture réelle.",
        evidence: '[Landini & Zandbergen, 1998]',
        confidence: 0.5,
        tags: 'unités,EVA',
    },
    {
        type: 'question',
        title: 'D’où viennent les effets de ligne et de paragraphe ?',
        content: "Certains glyphes et mots sont sur-représentés en début ou fin de ligne, et les premières lignes de paragraphe portent souvent des « pieds de table ». Mise en page, procédé de génération, ou marqueurs grammaticaux ? Mesurer avec algo_line_effects et comparer aux corpus générés.",
        evidence: '[Currier, 1976]',
        confidence: 0.5,
        tags: 'lignes,mise en page',
    },
    {
        type: 'plan',
        title: 'Programme de départ du laboratoire',
        content: "1) Importer la transcription EVA et 3 à 5 corpus de langues médiévales (latin, italien, occitan, allemand, tchèque…) de genres proches (herbiers, médecine). 2) Générer les textes de contrôle (Rugg, Timm & Schinner, mots mélangés, chiffres). 3) Comparer les empreintes de Voynich, A et B, avec les deux alphabets. 4) Tester les familles d'hypothèses dans l'ordre de ce qu'elles éliminent. 5) Travailler les indices (zodiaque, plantes) avec les images.",
        evidence: '[D’Imperio, 1978]',
        confidence: 0.6,
        pinned: true,
        tags: 'plan',
    },
];
const BIBLIOGRAPHY = `# Bibliographie de référence — Manuscrit de Voynich

Sélection des travaux cités dans la mémoire de l'équipe. À compléter par les documents eux-mêmes (PDF) dans la bibliothèque.

## Synthèses et ressources
- D'Imperio, M. E. (1978). *The Voynich Manuscript: An Elegant Enigma*. National Security Agency.
- Zandbergen, R. — site de référence *voynich.nu* (histoire, transcriptions IVTFF, bibliographie) : https://www.voynich.nu/
- Bowern, C. & Lindemann, L. (2021). « The Linguistics of the Voynich Manuscript ». *Annual Review of Linguistics*, 7.
- Reddy, S. & Knight, K. (2011). « What We Know About The Voynich Manuscript ». Workshop LaTeCH (ACL).

## Statistiques et structure
- Currier, P. (1976). *Papers on the Voynich Manuscript* (langues A et B, mains).
- Bennett, W. R. (1976). *Scientific and Engineering Problem-Solving with the Computer* (entropie du texte).
- Stolfi, J. — pages d'analyse de la structure des mots : https://www.ic.unicamp.br/~stolfi/voynich/
- Montemurro, M. A. & Zanette, D. H. (2013). « Keywords and Co-Occurrence Patterns in the Voynich Manuscript: An Information-Theoretic Analysis ». *PLoS ONE* 8(6).
- Zattera, M. (2022). Grammaire à cases (« slot alphabet ») et structure des mots, conférence internationale sur le manuscrit de Voynich.

## Matériel et paléographie
- Hodgins, G. (2009). Datation au carbone 14 du vélin, Université d'Arizona.
- Davis, L. F. (2020). « How Many Glyphs and How Many Scribes? Digital Paleography and the Voynich Manuscript ». *Manuscript Studies* 5(1).
- Landini, G. & Zandbergen, R. (1998). European Voynich Alphabet (EVA).

## Hypothèses de génération
- Rugg, G. (2004). « An Elegant Hoax? A Possible Solution to the Voynich Manuscript ». *Cryptologia* 28(1).
- Timm, T. & Schinner, A. (2020). « A Possible Generating Algorithm of the Voynich Manuscript ». *Cryptologia* 44(1).

## Propositions de déchiffrement (non retenues)
- Manly, J. M. (1931). Réfutation de Newbold, *Speculum*.
- Levitov, L. (1987). *Solution of the Voynich Manuscript*.
- Bax, S. (2014). « A proposed partial decoding of the Voynich script ».
- Hauer, B. & Kondrak, G. (2016). « Decoding Anagrammed Texts Written in an Unknown Language and Script ». *TACL* 4.
- Gibbs, N. (2017). *Times Literary Supplement*.
- Cheshire, G. (2019). *Romance Studies*.

## Corpus de comparaison conseillés (domaine public)
Pour le Laboratoire, privilégier des textes du XIVe–XVe siècle de genre proche (herbiers, médecine, astrologie, recettes) :
latin (herbiers, traités médicaux), italien, occitan, catalan, français médiéval, allemand, tchèque, hébreu, etc.
Sources possibles : Project Gutenberg (gutenberg.org), Wikisource, The Latin Library (thelatinlibrary.com), Corpus Corporum.
`;
export function seedKnowledge() {
    const existing = new Set(db.prepare(`SELECT title FROM memories`).all().map((r) => r.title));
    let created = 0;
    for (const s of SEEDS) {
        if (existing.has(s.title))
            continue;
        const m = createMemory({
            type: s.type,
            title: s.title,
            content: s.content,
            confidence: s.confidence,
            pinned: s.pinned,
            tags: `socle,${s.tags}`,
            authorLabel: 'Socle de connaissances',
            evidence: s.evidence,
        });
        if (s.status && s.status !== 'active')
            db.prepare('UPDATE memories SET status = ? WHERE id = ?').run(s.status, m.id);
        created++;
    }
    const hasBiblio = db.prepare(`SELECT id FROM documents WHERE title = ?`).get('Bibliographie de référence — Manuscrit de Voynich');
    if (!hasBiblio)
        createTextDocument('Bibliographie de référence — Manuscrit de Voynich', BIBLIOGRAPHY, 'socle,bibliographie', 'Voynich Lab');
    return { created, total: SEEDS.length, bibliography: !hasBiblio };
}
//# sourceMappingURL=seed.js.map