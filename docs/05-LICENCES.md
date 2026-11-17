# Audit des licences — composants pouvant affecter la distribution commerciale

Périmètre : `basirah-core.zip`, `basirah-quest.zip`, `basirah-phone.zip`, `Basirah-test.html`.
**Légende** : 🔴 bloquant tant que non réglé · 🟠 à vérifier / action requise · 🟢 a priori sans obstacle.
« Vérifié » = lu dans une source citée pendant cette session. « Non vérifié » = connaissance générale : à confirmer dans le fichier LICENSE d'origine. **Ceci n'est pas un avis juridique.**

## 1. Texte arabe du Coran — 🔴
| Fait | Source |
|---|---|
| Notre base (`data/quran-hafs-uthmani.json`, Hafs) vient de Tanzil. | notre ZIP |
| **Les en-têtes de licence/attribution de Tanzil ont été supprimés** des fichiers intégrés (seul le texte reste). Les conditions habituelles de Tanzil exigent de conserver l'avis de droit d'auteur et la source. | constaté dans le code ; conditions exactes de Tanzil **non vérifiées** (page de licence inaccessible depuis cet environnement) |
| La FAQ Tanzil indique que ses ressources liées sont « disponibles à des fins non commerciales ». | [Tanzil FAQ](https://tanzil.net/docs/FAQ) (vérifié) |
→ **Décision : ne pas livrer commercialement ce texte** sans (a) lire la licence Tanzil exacte et la respecter à la lettre, ou mieux (b) obtenir un accord écrit.

**Sources alternatives examinées (vérifié)**
| Source | Constat | Verdict pour Basirah |
|---|---|---|
| **Quran Foundation (Quran.com) API** — [conditions développeur](https://api-docs.quran.foundation/legal/developer-terms/) | Usage commercial permis (app payante, abonnements, publicité), texte jamais modifié. **Mais** : pas de base de données préchargée distribuée sans licence commerciale signée ; mise en cache limitée à 1 semaine sauf « Content Sync » (qui n'autorise pas non plus une base préchargée) ; entraînement de modèles = consentement écrit. | Incompatible avec le **mode hors ligne** (texte embarqué) sans licence commerciale signée ; adapté au mode en ligne. |
| **QUL (Tarteel)** — [FAQ](https://qul.tarteel.ai/faq) | « Oui, vous pouvez utiliser les données QUL dans des projets commerciaux », **mais la licence varie par ressource** ; scripts, mot-à-mot, audio : conditions non précisées sur la page ; **Hafs uniquement**, Warsh « prévu ». | Piste n°1 : choisir la ressource « script Hafs » dont la licence de **redistribution embarquée** est explicite ; demander confirmation écrite. |
| **KFGQPC (Complexe du Roi Fahd)** — [fiche de licence](https://scancode-licensedb.aboutcode.org/kfgqpc-uthmanic-script-hafs.html) | La police/texte « ne peut être reproduit, modifié sans approbation écrite expresse » ; catégorie « Proprietary Free » non définie ; usage commercial non traité. | Autorité d'origine (Hafs, et Warsh publié par le Complexe — non vérifié ici) : **demander l'approbation écrite**. |
| **Quran-Lab** (waqf, déjà en contact) | Le modèle s'appuie sur une phonétisation « canonique » d'un texte précis (`quran-transcript`). | Demander **quelle source de texte** ils utilisent et si elle peut être embarquée : cela alignerait texte, phonèmes et licence. |

**Warsh** : aucune source de texte Warsh vérifiée à ce jour.

## 2. Traductions — 🔴
Les 6 traductions embarquées (Hamidullah FR, Saheeh International EN, García ES, Ministère indonésien, Diyanet TR, Kuliev RU) sont des œuvres de tiers diffusées via Tanzil. Les en-têtes de nos fichiers indiquent uniquement « Source : Tanzil.net » ; **aucune licence par traduction n'est enregistrée** et Tanzil renvoie à un régime non commercial. → **Non autorisées commercialement** tant que chaque éditeur/ayant droit n'a pas donné son accord. Options : licences par traducteur, ou traductions sous licence ouverte vérifiée, ou traduction commandée. Les formules de prière traduites dans l'app sont rédigées par nous (marquées comme telles) : sans conflit, mais non relues par un savant — à faire relire.

## 3. Modèles de reconnaissance
| Modèle | Licence | Verdict |
|---|---|---|
| Quran-Lab Zipformer | Accord public Hugging Face : **gratuit pour l'utilisateur final uniquement, ni abonnement, ni publicité, ni revenu ; mêmes conditions transmises** ([fiche](https://huggingface.co/Muno459/zipformer_p-quran)). Vous avez une **permission** : sa portée n'est pas encore documentée. | 🟠 → voir `06-QURANLAB-PERMISSION.md`. Le code refuse une construction commerciale tant que la preuve n'est pas enregistrée (`src/licensing/gate.ts`). |
| Whisper base ajusté Coran (tarteel-ai) | Apache-2.0 déclarée sur la fiche ; **données d'entraînement non indiquées** ([fiche](https://huggingface.co/tarteel-ai/whisper-base-ar-quran/blob/main/README.md?code=true)). | 🟠 Licence du modèle correcte, mais l'origine des données d'entraînement est inconnue : risque résiduel à documenter. Comparaison/solution de repli seulement. |
| Whisper générique (`Xenova/whisper-base`, utilisé par l'ancien HTML) | Poids OpenAI sous licence MIT (non vérifié ici) | 🟢 mais **téléchargé au premier lancement depuis Internet** → contraire au « hors ligne réel » ; à retirer. |
| Modèles ggml pour whisper.cpp (scripts `prepare.sh`) | idem Whisper | 🟢/🟠 vérifier la licence du dépôt Hugging Face utilisé. |

## 4. Enregistrements d'évaluation / d'entraînement — 🔴 si mal géré
Trois usages distincts, jamais confondus (`src/eval/manifest.ts`) : **évaluation interne**, **entraînement**, **redistribution/commercial**. Chaque enregistrement porte sa licence et ses preuves ; `null` = refusé.
- **YouTube / Taraweeh** : rien n'est autorisé par défaut. Les conditions de la plateforme et les droits du récitant/de la mosquée sont **deux choses distinctes** ; aucun téléchargement tant qu'une permission n'est pas enregistrée. Les liens sont conservés dans le manifeste, sans fichier.
- **Quran-Lab benchmark** ([fiche](https://huggingface.co/datasets/Quran-Lab/quranic-asr-benchmark)) : 600 clips Hafs, accès avec accord, **usage limité à la recherche/évaluation ASR, redistribution interdite**, respect des conditions amont. Idéal comme premier banc **interne** ; interdit pour entraînement ou produit.
- **EveryAyah** : la fiche ci-dessus indique CC-BY 4.0 (à vérifier à la source, récitant par récitant).
- **Vos propres enregistrements** : à faire avec accord écrit des récitants/imams (usage interne, puis entraînement si souhaité).

## 5. Bibliothèques et services (non vérifié — connaissance générale)
| Composant | Licence présumée | Remarque |
|---|---|---|
| whisper.cpp v1.7.2 (compilé dans l'APK) | MIT | conserver l'avis |
| sherpa-onnx, ONNX Runtime | Apache-2.0 / MIT | conserver les avis |
| AndroidX, Kotlin, Gradle | Apache-2.0 | |
| **Meta Spatial SDK** (projet Quest seulement) | licence Meta | à lire avant toute diffusion Quest ; absent de la version téléphone |
| transformers.js, three.js (ancien HTML, chargés depuis un CDN) | Apache-2.0 / MIT | **à retirer** (hors ligne + confidentialité) |
| **MyMemory** (traduction, ancien HTML) | conditions de service/quotas | envoie du texte à un tiers ; à remplacer |
| API `Translator` de Chrome | fonctionnalité du navigateur | non maîtrisée |
| Polices intégrées : Amiri Quran, Plus Jakarta Sans, Space Grotesk, JetBrains Mono | SIL OFL (présumé) | **les textes OFL et avis de droit d'auteur ne sont pas dans le ZIP** : à ajouter ; vérifier chaque police |
| Logo / animation Basirah | vous | 🟢 |

## 6. Plan d'action (ordre)
1. Écrire à Quran-Lab : portée exacte de la permission (voir doc 06) **et** source du texte/phonétisation.
2. Demander à Tanzil, KFGQPC et QUL l'accord écrit d'embarquer le texte (Hafs) dans un produit commercial ; retenir la source la plus claire.
3. Décider des traductions (accords ou licences ouvertes vérifiées).
4. Supprimer du produit tout téléchargement de modèle/CDN/traduction tierce au runtime.
5. Ajouter les avis de licence (OFL, MIT, Apache) et les attributions requises.
6. Tenir `permissions/*.json` à jour : la construction commerciale s'arrête si une preuve manque.
