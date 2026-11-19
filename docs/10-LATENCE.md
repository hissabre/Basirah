# Latence : d'où viennent les secondes, et ce qui donne des millisecondes

Mesures SIMULÉES de la logique (faux moteurs ; elles ne disent rien de la qualité réelle des modèles), du 2026-11-17 :

| Maillon | Mesure | Source |
|---|---|---|
| Alignement, reconnaissance parfaite, départ à froid | verrouillage après 3 mots (médiane), 6 mots (90e centile) ; 16 versets sur 285 jamais verrouillés (versets répétés/ambigus) | `/tmp` banc de 300 versets aléatoires |
| Alignement en suivi | position confirmée 0 à 1 mot derrière l'hypothèse courante | essai |
| Whisper en fenêtres glissantes, passe de 1 s | retard médian ≈ 2,4 s (accord entre passes) · 2,8 s (retenue 2 mots) | `test/run-whisper.ts` |
| Whisper, passe de 3 s | retard médian ≈ 6,8 s · 5,3 s | idem |
| Moteur du navigateur (Google), mesure réelle | positions seulement aux résultats FINAL avant le correctif ; 0,5 à 1 s de décalage propre au service | rapport de l'utilisateur du 2026-11-17 |

**Conclusion** : l'algorithme d'alignement n'est pas le goulot. Whisper n'est pas un modèle en flux : son plancher est (durée d'une passe + pas + mots retenus) ≈ 2 à 3 s au mieux. Des millisecondes exigent un modèle acoustique en flux (CTC, résultat toutes les 160–320 ms : TajweedFormer V4 ou Zipformer de Quran-Lab) et un alignement contraint sur les phonèmes attendus du verset. Cette voie est limitée par la licence NPL-1.2 (gratuit uniquement).

Architecture visée : un chemin rapide (CTC en flux, curseur en < 0,5 s) + un chemin sûr (Whisper, corrige et confirme). Le chemin rapide dépend de la sortie brute du SDK, pas encore vue.
