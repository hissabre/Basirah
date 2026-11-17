# MISE À JOUR 2026-11-17 — chemin recommandé : le SDK web TajweedFormer V4

Quran-Lab recommande désormais **TajweedFormer V4** (65 M paramètres, 38 sons, sorties de tajweed séparées : prolongation, gémination, ghunna, qalqalah), servi par SDK (web/WebAssembly, Android, iOS, Windows/Linux) : **aucun fichier de modèle à télécharger**. Zipformer Quran 3.2 n'est plus servi par le SDK (fichiers restés sur Hugging Face, accès sur demande, INT8 ONNX + tokens.txt).
Votre action (2 minutes) : sdk.quranlab.ai → connexion Hugging Face → accepter la licence → créer une **clé web** liée à l'adresse https où vous hébergez la page → la coller dans le champ de la page (moteur « TajweedFormer V4 »). Dites-moi ensuite ce que la zone « Sortie brute » affiche. L'alignement sur ses 38 sons reste à écrire ; il dépend de ce format réel et du jeu `quran-tajweed-phonetics` (téléchargement libre).
**Licence : voir LICENCE-QURANLAB.md — l'usage payant est interdit par NPL-1.2.**

---
(ancien document, pour le Zipformer)
# Modèle Quran-Lab : ce qu'il faut, où le mettre

**Lien repéré (à confirmer par vous)** : https://huggingface.co/Quran-Lab/zipformer_p-arabic-v3 — page protégée : « You need to agree to share your contact information to access this model ». Je n'ai pas pu l'ouvrir : le nom (« p-arabic-v3 ») ne dit pas si c'est le modèle coranique que Quran-Lab vous a autorisé. **Confirmez auprès de Quran-Lab le nom exact du dépôt.**

## Ce que vous faites
1. Vous connecter à Hugging Face, ouvrir le lien, accepter l'accord (partage de vos coordonnées).
2. Lire la licence affichée sur la page (des modèles voisins indiquent « non commercial ») et la recopier dans `permissions/quranlab-zipformer.json` avec la preuve de la permission écrite de Quran-Lab.
3. Onglet « Files and versions » : télécharger les fichiers ci-dessous (noms attendus, NON vérifiés, ceux de la page font foi) :
   - le modèle ONNX int8 du Zipformer CTC streaming (~73 Mo) ;
   - `phoneme_units.json` ; `quran_text2phoneme.json` ; tout fichier `tokens.txt` ou configuration fournis.
4. Les déposer dans `models/quranlab-zipformer/` (dossier non versionné), ou les envoyer ici dans le chat.

## Runtime navigateur (je ne peux pas le télécharger)
Le moteur hors ligne dans la page demande le runtime sherpa-onnx WebAssembly (fichiers `.wasm` + `.js` du projet k2-fsa/sherpa-onnx, section WebAssembly ASR). À déposer dans `models/runtime/` ; je ferai l'intégration ensuite.

## Si les fichiers sont trop gros pour GitHub
Ne pas les mettre dans le dépôt : les placer sur un stockage privé (Cloudflare R2 / Hugging Face privé) ; la page les chargera depuis `offline.modelBaseUrl` dans la configuration. Ce chargement n'est pas encore écrit : il le sera quand je saurai où les fichiers seront.

## Ce qui est FAIT / PAS FAIT
Fait : interface `ZipformerEngine`, adaptateur `sherpa-onnx-node` (Node), alignement par phonèmes, tests en simulation. Pas fait : exécution réelle (modèle absent), pont WebAssembly pour le navigateur, conversion `quran_text2phoneme.json` (format inconnu).
