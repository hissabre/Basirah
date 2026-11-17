# Statut (2026-11-17)
- Fonctionne (testé dans Chromium avec micro factice et faux moteur de parole injecté) : page, 4 modes, sélection du moteur, erreurs explicites, diagnostic micro, panneau d'état.
- Jamais testé : micro réel, audio coranique réel, Zipformer, sherpa-onnx, relais en ligne réel, Deepgram, traduction.
- SDK Quran-Lab TajweedFormer V4 : moteur écrit d'après la documentation, jamais exécuté.
- Bloqué par des accès extérieurs : modèle Quran-Lab (accord Hugging Face), runtime WASM, clé fournisseur, licence du texte coranique et des traductions.
- Alternatives ouvertes repérées (2026-11-17, à vérifier) : quranic-phonemizer (MIT) pour les phonèmes attendus ; quran-muaalem (Apache 2.0 + conditions) pour reconnaissance/tajweed côté serveur. Ces deux pistes ne sont pas soumises à NPL-1.2.
