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
