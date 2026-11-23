# Modèles ouverts pour la reconnaissance du Coran (état au 23/11/2026)

Source : fiches Hugging Face lues par recherche web (pas les textes de licence complets). Chiffres = ceux des auteurs.

| Modèle | Licence (fiche) | Utilisable pour Basirah ? | Intégration |
|---|---|---|---|
| **Abdou/quran-asr-tiny** (16 M, 19 Mo int8) | MIT (code + poids). Données d'entraînement : EveryAyah (termes everyayah.com), tlog CC-BY-4.0, Iqra_train sans licence indiquée | Oui ; zone grise sur les données si on ré-entraîne | **Documenté** : ONNX zipformer-CTC sherpa-onnx, entrée `x [N,T,80]` fbank + `x_lens`, sortie `log_probs`, 31 classes, sous-échantillonnage 4. Hors ligne (pas en flux). 6,9–7,1 % WER (téléphone : 18 %). Lettres sans voyelles. |
| **Khatma** (adnanfet/khatma-model, 89 Mo) | CC BY 4.0 (+ NVIDIA CC BY 4.0, export Tilawa MIT) | Oui avec crédits | **Format .bin propriétaire non documenté** (fiche : « déballé dans le navigateur ») → impossible à intégrer sans le spécifier. C'est le modèle arabe GÉNÉRAL de NVIDIA reconditionné (pas un modèle entraîné sur le Coran d'après la fiche). Aucun chiffre de précision. |
| Muno459/fastconformer-quran (+ streaming) | **NPL-1.0 d'après la réponse de l'auteur** (la fiche du modèle disait Apache 2.0) | **Non commercial** | — |
| Muno459/zipformer_p-quran | Gratuit non commercial | Non | — |
| Quran-Lab zipformer / TajweedFormer | NPL-1.2 | Version gratuite seulement | — |
| tarteel-ai/whisper-*-ar-quran | Apache-2.0 (page) | Oui | Whisper : pas de flux (2–3 s). Pas d'ONNX publié pour transformers.js d'après ce que j'ai vu : conversion nécessaire. |
| Whisper (actuel) | MIT | Oui | Non adapté au Coran, pas de flux. |

## Décision
Cible : **quran-asr-tiny** (documenté, MIT, entraîné sur le Coran, minuscule) + notre décodeur contraint (`src/decoder/ctc-tracker.ts`).
Hors ligne par nature : on l'utilise sur fenêtres glissantes ; le décodeur cherche la position dès que les derniers signes sont fiables.

## Pour intégrer sans deviner
1. Lancer le workflow `inspect-quran-asr-tiny` (Actions → Run workflow) → artefact `quran-asr-tiny-spec` (spec.json, golden.json, code du modèle, 3 enregistrements réels).
2. Comparer `src/audio/fbank.ts` à `golden.json` (réglages exacts, échelle des échantillons).
3. Moteur navigateur onnxruntime-web (≥ 1.24.2 d'après la fiche Khatma pour les opérateurs int8), fenêtres glissantes, branchement sur le décodeur, crédits dans l'application.
4. Mesurer sur le banc d'essai face à Whisper.

## Crédits à afficher (si Khatma/NVIDIA sont utilisés)
« NVIDIA FastConformer (CC BY 4.0), adapté et quantifié par Khatma (CC BY 4.0), d'après l'export Tilawa (MIT). Modifié pour Basirah. » — recopier le texte exact de la fiche au moment de l'intégration.
