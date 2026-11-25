# Moteur hors ligne « Basirah Coran » (novembre 2026)

## Principe
1. **Micro → fbank en flux** (`src/audio/fbank.ts`, `StreamingFbank`) : chaque tranche de 10 ms est calculée une seule fois.
2. **Modèle acoustique** : `Abdou/quran-asr-tiny` (MIT, 16 M paramètres, 19 Mo int8), entraîné sur la récitation, sortie = lettres du rasm uthmani (29 lettres + séparateur).
   Exécuté par ONNX Runtime Web 1.27.0 (WebAssembly) dans un worker (`src/engine/quran-ctc-worker-src.ts`).
   Fenêtre glissante de 2,4 s relancée toutes les ~0,24 s (le pas s'allonge seul si l'appareil est lent).
   Noms d'entrées/sorties lus dans le modèle ; échelle du signal (1 ou 32768) choisie automatiquement sur la première voix.
3. **Localisation par lettres** (`src/decoder/letter-locator.ts`) : les lettres entendues sont alignées (distance d'édition) sur le texte du Coran
   autour de la position courante ; recherche dans tout le Coran par index de 7 et 5 lettres ; on ne saute ailleurs que si un autre passage
   explique nettement mieux les 24 dernières lettres, deux lettres de suite. Position confirmée seulement si elle est unique (la basmala ne l'est jamais).
4. **Session** : position confirmée + position provisoire + « Entendu » (lettres brutes du modèle).

## Publication
Le workflow `build-and-deploy` copie le modèle (`public/models/quran-asr-tiny/`) et ONNX Runtime (`public/vendor/ort/`) avec la page :
aucun téléchargement externe à l'utilisation. À défaut, repli automatique sur Hugging Face / jsDelivr. Ensuite tout reste dans le cache du navigateur.

## Mesures
- Simulation (modèle SIMULÉ, `test/run-quranctc.ts`) : retard médian 0,27–0,44 s entre la récitation d'un mot et sa position confirmée ;
  départ à froid au milieu d'une sourate : ~2 s ; sauts de sourate, verset sauté, verset répété, refrain d'Ar-Rahman : suivis.
- Chaîne navigateur vérifiée dans Chrome avec un runtime SIMULÉ (chargement, cache, passes, images, affichage).
- **Jamais exécuté avec le vrai modèle ni une vraie voix** : précision et temps de passe réels = premier essai chez l'utilisateur
  (Diagnostic → Statistiques du moteur : `passeMediane` en ms, `echelle`, `io`).

## Limites connues
- Hifz : suivi et blocage oui ; comptage des erreurs mot par mot pas encore branché sur ce moteur.
- Pas de multi-fil (GitHub Pages n'envoie pas les en-têtes COOP/COEP) : à activer si la passe médiane dépasse ~250 ms.
