# Jeu de données réel et banc d'essai

## Structure (`src/eval/manifest.ts`, exemple : `dataset/manifest.example.json`)
Par enregistrement : audio (chemin local, jamais dans le dépôt) · récitant · riwaya (hafs/warsh) · références sourate/verset (+ heures par verset pour le suivi) · source (propre, YouTube, EveryAyah, benchmark Quran-Lab, autre) · **licence par usage** (évaluation interne / entraînement / redistribution / commercial ; `null` = refusé) · conditions (lieu, bruit, réverbération, vitesse, style, micro) · séparation dev/test. `validate()` vérifie les références contre le Coran ; `can()` applique la licence.

## Sources à utiliser — dans cet ordre
1. **Quran-Lab quranic-asr-benchmark** (600 clips Hafs : EveryAyah propres, un récitant QUL, vrais micros de téléphone) : évaluation **interne** seulement. Attention : c'est le banc de Quran-Lab, donc **non vu par le Zipformer**, mais le Whisper Coran de tarteel-ai peut avoir été entraîné sur des données voisines (EveryAyah) : fuite possible → à signaler dans toute comparaison.
2. **Enregistrements propres** (récitants/imams avec accord écrit) : prière réelle, mosquée, Taraweeh, Warsh. C'est ce qui manque le plus.
3. **EveryAyah** (CC-BY 4.0 selon la fiche du benchmark — à vérifier à la source) pour construire des récitations continues avec vérité exacte : `bench/concat_ayat.py`.
4. **YouTube/Taraweeh** : seulement après permission enregistrée (voir `05-LICENCES.md`). Sans permission : le manifeste garde le lien, le banc refuse l'enregistrement.

## Lancer (sur votre machine)
```
python bench/run_engines.py --manifest dataset/manifest.json --audio-root AUDIO --engine zipformer --model quran_phoneme_zipformer.int8.onnx --tokens tokens.txt --out out/zipformer
python bench/run_engines.py --manifest dataset/manifest.json --audio-root AUDIO --engine whisper-quran --out out/whisper-quran
npm run eval -- --manifest dataset/manifest.json --hyps out/zipformer      --engine zipformer      --lexicon data/quranlab-lexicon.json
npm run eval -- --manifest dataset/manifest.json --hyps out/whisper-quran  --engine whisper-quran
```
Même manifeste, mêmes fichiers pour les deux moteurs. Rapports : `reports/<moteur>.json|.md` (par lieu, bruit, vitesse, récitant), plus `out/*/_perf.json` (facteur temps réel).

## Ce qui est comparable — et ce qui ne l'est pas
- **Commun aux deux moteurs** : suivi (verset correct, retard d'apparition, sauts erronés, récupération) via le même `Stabilizer → Aligner`, et vitesse (RTF).
- **Propre à chaque moteur** : Whisper → WER/CER (texte) ; Zipformer → PER (phonèmes, nécessite le lexique réel). Aucun chiffre de WER n'est comparé à un PER.
- Whisper n'est pas un moteur streaming : ses résultats arrivent par segments ; la latence d'affichage est donc mesurée par `lagSec` sur les mêmes enregistrements, pas supposée.

## Statut
Testé : métriques (valeurs calculées à la main), manifeste/licences, rejeu du suivi, évaluateur de bout en bout sur un jeu **simulé**. **Aucun enregistrement réel n'a été traité et aucun résultat de moteur réel n'existe encore.**
