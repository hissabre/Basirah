# Intégration Zipformer (sherpa-onnx)

## Fait (testé avec un faux backend — pas avec le vrai modèle)
- `ZipformerEngine` (`src/engine/zipformer.ts`) implémente l'interface commune : un bloc audio → un appel au flux, **sans fenêtre, sans chevauchement, sans lot** ; une seule inférence à la fois ; file bornée (5 s par défaut) avec abandon **compté et signalé** ; erreur → état `error`, **aucune relance automatique** ; confiance jamais inventée (`null`).
- Sortie en **phonèmes** (`unit:'phoneme'`, `tokens`) ; le `Stabilizer` valide les unités par accord local.
- `PhonemeDB` + profil d'alignement `phoneme` : même `Aligner` que pour les mots, au niveau des unités, avec position mot par mot (`wordOf`). Mesuré en simulation (unités de **substitution**, erreurs fabriquées) : à PER simulé 10 / 15 / 25 %, verset correct 94,5 / 92,6 / 84,5 %, 0 saut erroné (72 passages chacun), verrouillage ≈ 17–20 unités. Seuils réglés sur d'autres tirages que ceux du test.
- Même chemin pour le mot (Whisper, API en ligne) : `Stabilizer → Aligner` ; un moteur en ligne se branche sans toucher à l'alignement.

## Pas fait / bloqué (et pourquoi)
1. **Modèle, tokenizer et table texte→phonèmes absents** : Hugging Face est inaccessible depuis cet environnement et le dépôt est à accès restreint. Le chargeur de la vraie table (`quran_text2phoneme.json`, 250 unités `phoneme_units.json`) reste à écrire une fois les fichiers en main : il doit produire un `PhonemeLexicon` (`{verses:[{s,a,words:[[unité…]]}]}`). **Le jeu d'unités du modèle n'est pas celui de mon phonétiseur de substitution** : les chiffres ci-dessus valident l'algorithme, pas le modèle.
2. **Paquet `sherpa-onnx` non installable ici** : `nodeBackend()` (Node) suit l'API publique mais n'a **jamais été exécuté** ; le banc Python (`bench/run_engines.py`) non plus.
3. **Navigateur (WASM)** : pas de backend écrit ; à faire seulement si le test sur votre machine montre un temps réel suffisant.
4. **Dérivation mot / détection d'erreurs Hifz** : la position phonémique donne déjà le mot ; la comparaison phonème par phonème contre le texte attendu (mot omis, substitution) sera ajoutée après validation du PER réel, pas avant.

## Liste de contrôle sur votre machine (dans l'ordre)
1. `pip install -r bench/requirements.txt` ; récupérer `quran_phoneme_zipformer.int8.onnx`, `phoneme_units.json`, `quran_text2phoneme.json` (accès Hugging Face).
2. Produire `tokens.txt` (`<unité> <id>` ; vérifier l'id du « blank » dans les métadonnées ONNX / la fiche) — **sans cela sherpa-onnx ne décode pas correctement**.
3. Vérifier que `OnlineRecognizer.from_zipformer2_ctc` (Python) accepte le modèle (le modèle annonce un CTC streaming compatible sherpa-onnx, les paramètres de chunk sont dans les métadonnées ONNX) ; sinon noter l'erreur : c'est la première information utile.
4. Lancer le banc (voir `08-DATASET-EVAL.md`) et lire le facteur temps réel (RTF) : < 1 requis ; viser < 0,5 sur téléphone.
