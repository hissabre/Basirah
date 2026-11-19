# Décodeur contraint par le texte du Coran (`src/decoder/ctc-tracker.ts`)

## À quoi il sert
Obtenir une position **à chaque image audio (20–80 ms)** au lieu d'attendre un mot entier, avec n'importe quel modèle « en flux » qui rend des probabilités CTC (TajweedFormer, Zipformer, notre futur modèle, encodeur Whisper + tête CTC…).
Le texte étant connu, on ne décode pas du texte libre : on suit un chemin dans le graphe du Coran (rester / avancer / sauter une unité), plus quelques hypothèses semées quand le modèle « voit » une suite d'unités qui existe dans le Coran.

## Ce qui est mesuré — SORTIES DE MODÈLE SIMULÉES (`test/run-ctc.ts`)
Aucun vrai modèle acoustique n'a été exécuté. Le simulateur génère des probabilités pointues (images de 40 ms, ~10 unités/s, retard de modèle 160 ms) avec substitutions/suppressions/insertions. Les unités sont celles d'un phonétiseur de SUBSTITUTION (lettre + voyelle), pas celles d'un vrai modèle.

| Cas | Résultat |
|---|---|
| Départ connu, modèle « propre » (~12 % d'erreurs d'unité) | position juste (±2 unités) 98,3 % des images |
| Départ connu, modèle bruité (~30 %, pics nets) | 94,3 % |
| Retard ajouté par le décodeur | 0 ms (médiane), p90 ≈ 80–120 ms — **le retard du modèle s'y ajoute** |
| Coût CPU | ≈ 0,04 ms/image (Node, pas un téléphone) |
| Départ à froid | position correcte après ≈ 0,6 s (médiane), p90 1,2 s ; indicateur « verrouillé » plus prudent (≈ 3,4 s) |
| Saut de verset | reprise 20/20, médiane 0,76 s |
| Autre vocabulaire (lettres seules) | 97,5 % |

**Latence totale attendue** = délai du modèle (bloc de 160–320 ms) + ≈ 0 pour le décodeur. C'est une estimation de simulation, pas une mesure.

## Limite connue (mesurée)
Si le modèle est **peu sûr de lui** (pics de probabilité 0,25–0,8 même quand il a raison), le suivi décroche (29 % de positions justes dans le test). Il faudra recalibrer sur un vrai modèle : `advFloor`, température/sharpening des log-probas. Le test l'affiche explicitement.

## Pas encore fait
- Branchement dans `Session`/`RecognitionEngine` (le décodeur sort un indice d'unité ; la session consomme aujourd'hui des textes).
- Table d'unités du vrai modèle (TajweedFormer : à lire dans la « sortie brute » du SDK ; ou notre propre modèle).
- Exécution sur un vrai modèle et un vrai micro.
