# Ce qui demande votre intervention

1. **Diagnostic micro 30 min** (Chrome/Edge) : envoyer le rapport exporté.
2. **Quran-Lab** : fournir les fichiers du modèle (.onnx int8, `phoneme_units.json`, `quran_text2phoneme.json`) et le texte exact de la permission (usage commercial, modification, redistribution des poids, travaux dérivés) → `permissions/quranlab-zipformer.json` (aujourd'hui tout à `null`).
3. **Premier essai réel** : `docs/SETUP.md` §4 ; m'envoyer la sortie brute. Il faudra aussi confirmer l'identifiant du blank CTC et écrire `entry_to_words` selon le vrai format.
4. **Enregistrements + transcriptions + droits** : `npm run dataset:add`.
5. **Texte coranique** : licence de la source (Tanzil/Quran-Lab/QUL/KFGQPC) ; l'avis d'origine a été retiré du fichier et doit être restauré. Bloque toute version commerciale.
6. **Traductions** (français/anglais) : licences à obtenir.
7. **En ligne** : choix du fournisseur, clé côté serveur, test de l'adaptateur `deepgram` (non testé, prise en charge de l'arabe/Coran non vérifiée).
8. **Natif** : décider Capacitor ou applications natives ; matériel des lunettes.
9. Éléments `unverified` de `licensing/inventory.json`.

## Modèle Whisper embarqué (aucun téléchargement externe)
Le code est prêt : si le dossier `public/models/Xenova/whisper-base/` existe sur le site, l'application l'utilise et n'appelle PLUS Hugging Face (le moteur transformers.js est encore chargé depuis un CDN — à embarquer aussi, voir plus bas).
1. Sur la page https://huggingface.co/Xenova/whisper-base/tree/main : télécharger (avec votre accord) `config.json`, `generation_config.json`, `preprocessor_config.json`, `tokenizer.json`, `tokenizer_config.json` + dans `onnx/` : `encoder_model_quantized.onnx`, `decoder_model_merged_quantized.onnx` (mode processeur) et, pour le mode carte graphique, `encoder_model.onnx`, `decoder_model_merged_q4.onnx`.
   Noms déduits des conventions de transformers.js, NON vérifiés : si un fichier manque, l'erreur affichée par la page donne l'adresse exacte à ajouter.
2. Les placer dans `public/models/Xenova/whisper-base/` (sous-dossier `onnx/` inclus) du dépôt. Limite d'envoi GitHub par navigateur : 25 Mo par fichier — pour un fichier plus gros, me le dire : je prépare un découpage.
3. NON TESTÉ : le chargement local n'a pas pu être exécuté ici (Hugging Face inaccessible depuis mon environnement).
