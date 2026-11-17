# Installation et premiers essais

## 1. Prérequis
Node ≥ 22, Python ≥ 3.10 (banc Python seulement), Chrome ou Edge (diagnostic micro).

## 2. Installer et vérifier le code (rien de réel n'est exécuté ici)
```
npm i            # installe ws
npm test         # 6 suites simulées
npm run typecheck
```

## 3. Diagnostic micro (30 min) — à faire en premier
Ouvrir `Basirah-diagnostic-micro.html` via un serveur local (`npx serve diag` ou `python -m http.server`), pas en `file://`. Lancer 30 min, exporter le rapport et me l'envoyer.

## 4. Zipformer réel (sherpa-onnx)
1. `npm i sherpa-onnx-node`
2. Placer le modèle int8 (`.onnx`), `phoneme_units.json` et `quran_text2phoneme.json` fournis par Quran-Lab dans un dossier de travail (hors dépôt).
3. `python tools/inspect_quranlab_table.py quran_text2phoneme.json` : affiche la structure ; adapter `entry_to_words` dans `bench/convert_lexicon.py`, puis `python bench/convert_lexicon.py quran_text2phoneme.json data/quranlab-lexicon.json`.
4. `python tools/make_tokens.py phoneme_units.json --blank-id <ID> [--shift 1] --out tokens.txt`. L'identifiant du blank doit être vérifié (taille de sortie du modèle = unités + 1).
5. `npm run try:zipformer -- --wav audio16k.wav --model <modèle.onnx> --tokens tokens.txt --lexicon data/quranlab-lexicon.json`
   (WAV 16 kHz mono : `ffmpeg -i in.mp3 -ar 16000 -ac 1 audio16k.wav`).
6. Copier-coller la sortie complète, y compris les erreurs. Rien n'est considéré comme fonctionnel avant ce résultat.

## 5. Évaluation sur vos enregistrements
`npm run dataset:add -- --manifest dataset/manifest.json …` (voir l'en-tête de `tools/dataset-add.ts`), puis `npm run eval` et, pour la comparaison avec Whisper, `bench/` (voir `08-DATASET-EVAL.md`). Sans `--evidence`, aucun usage n'est autorisé.

## 6. Mode en ligne
`config/basirah.config.example.json` → copier en `basirah.config.json`, remplacer chaque `<À_RENSEIGNER>`. `npm run relay` démarre le relais (clé du fournisseur côté serveur seulement). L'adaptateur `mock` est testé ; `deepgram` ne l'est pas.

## 7. Licences
`npm run licence:check -- commercial` liste ce qui bloque une version commerciale (actuellement 10 éléments).
