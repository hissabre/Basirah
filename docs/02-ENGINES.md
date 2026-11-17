# Recommandation de moteurs de reconnaissance (Phases 3 / 7)

**Principe** : l'alignement connaît le texte du Coran ; le moteur n'a pas besoin d'être parfait, mais ses erreurs doivent être *proches phonétiquement*. Aucune des options ci-dessous n'a été testée par Basirah sur des enregistrements réels : **tout chiffre cité vient de la documentation du fournisseur ou de la fiche du modèle, pas de nos mesures.**

## Hors ligne
| Option | Ce que dit la source | Statut pour Basirah |
|---|---|---|
| **Whisper base ajusté au Coran** — [tarteel-ai/whisper-base-ar-quran](https://huggingface.co/tarteel-ai/whisper-base-ar-quran/blob/main/README.md?code=true) | Licence Apache-2.0. WER final 5,75 annoncé, **mais la fiche ne précise ni les données d'entraînement ni le jeu de test**. | Meilleure piste hors ligne *commercialisable* identifiée. À mesurer sur nos propres enregistrements avant toute décision. Non « streaming » : à utiliser par segments (voir ci-dessous), via whisper.cpp (mobile) ou ONNX/transformers.js (navigateur). |
| **Zipformer Coran en streaming** — [Muno459/zipformer_p-quran](https://huggingface.co/Muno459/zipformer_p-quran) | 65,5 M paramètres, ONNX int8 73 Mo, compatible sherpa-onnx, vrai streaming par blocs, sortie en **phonèmes** ; PER 11,63 % (7,69 % audio propre, 13,49 % micro de téléphone) ; WER 5,83 « par récupération du verset le plus proche » (v1.0). | Technologiquement idéal (streaming, léger, phonèmes → très utile pour Hifz). **Licence NPL-1.1 : réservé aux applications gratuites pour l'utilisateur, sans abonnement, publicité ni revenu ; accès sur demande.** Incompatible avec un produit commercial sans accord écrit des auteurs. → Contacter Quran-Lab ; ne pas l'embarquer d'ici là. |
| Whisper générique (état actuel) | — | À abandonner pour le Coran. |

**Utilisation de Whisper (non streaming) correcte** : détecter la parole (VAD), découper aux pauses ou par blocs ≥ 2–3 s, traiter **chaque segment une seule fois**, jamais de fenêtres chevauchantes renvoyées. Résultats provisoires possibles par « accord local » (le `Stabilizer` fournit ce mécanisme). Latence attendue = durée du segment + temps d'inférence : à mesurer ; c'est la limite connue de Whisper pour le mode Prière.

## En ligne
| Option | Ce que dit la source | Statut |
|---|---|---|
| **Deepgram (famille Nova)** — [page arabe](https://deepgram.com/product/speech-to-text/arabic) | Transcription **streaming** arabe annoncée ; « moins de 300 ms » (affirmation du fournisseur, conditions non données) ; variétés listées : arabe standard et dialectes ; **rien sur la récitation coranique, ni sur Hafs/Warsh**. | Candidat sérieux pour la latence ; précision sur récitation **inconnue** → à benchmarker. |
| Google Cloud STT, Azure Speech, ElevenLabs Scribe (temps réel), OpenAI (transcription temps réel) | Non vérifiés dans cette session. | À évaluer sur le même banc : ne pas supposer. |
| **Serveur Basirah** hébergeant un modèle Coran (ex. Whisper ajusté ou zipformer sous licence) | Dépend de la licence et d'un coût GPU. | Hypothèse : probablement la meilleure précision *sur le Coran* ; à comparer aux API génériques. |

**Architecture en ligne recommandée** : le client envoie l'audio 16 kHz en flux (WebSocket) à un **petit serveur Basirah** (la clé API ne quitte jamais le serveur ; TLS ; reconnexion avec reprise de position) qui relaie vers le fournisseur choisi. Le client ne dépend ainsi d'aucun fournisseur et on peut changer de moteur sans mise à jour de l'application.

## Matériel (hypothèses à valider par mesure sur appareil)
- Navigateur de développement : Whisper Coran (base) dans un Worker, WebGPU si disponible sinon WASM ; mode dégradé annoncé clairement.
- Téléphone / tablette : whisper.cpp natif (tiny/base quantifié) ou zipformer sherpa-onnx si la licence le permet.
- Lunettes : dépend du SoC et de la batterie ; modèle le plus petit qui passe le seuil de précision ; mesure obligatoire (CPU, température, autonomie).

## Warsh
Le texte Warsh n'est pas dans nos données (Tanzil Uthmani = Hafs). Il faut une source Warsh sous licence + des enregistrements Warsh annotés ; l'architecture (`QuranDB` par riwaya) le permet, mais **rien n'est supporté tant que ces données n'existent pas**.
