# Permission Quran-Lab — registre

**État : non documenté.** Vous m'avez indiqué que Quran-Lab (waqf) a donné sa permission d'utiliser son modèle Zipformer. Je n'ai ni le texte ni la portée de cette permission, et je ne la suppose pas : **chaque droit ci-dessous reste « non confirmé » (= refusé par le code) tant que vous ne m'envoyez pas le document ou ses termes exacts.**

Ce que dit l'accord **public** (Hugging Face, vérifié) — à comparer avec votre permission :
- autorisé : utiliser, affiner et redistribuer le modèle et ses sorties **dans des applications gratuites pour l'utilisateur final** ;
- interdit : vendre, abonnement/paywall, publicité, tout revenu lié à l'application ou à ses sorties ; conditions transmises à quiconque reçoit le modèle ;
- licence indiquée : NPL-1.1 ; fichier LICENSE complet non reproduit sur la fiche ; modification limitée à l'affinage sous les mêmes conditions.

## À obtenir par écrit (cocher dans `permissions/quranlab-zipformer.json`)
| Droit | Question précise à poser | Valeur actuelle |
|---|---|---|
| Usage commercial | Basirah sera-t-elle payante (abonnement, achat, lunettes vendues) ou financée par des revenus ? Autorisé ? Conditions (redevance, mention, plafond) ? | non confirmé |
| Modification / affinage | Peut-on affiner le modèle (Hafs, puis Warsh) ? Qui possède les poids dérivés ? | non confirmé |
| Redistribution des poids | Peut-on embarquer le fichier ONNX int8 dans l'application / le firmware des lunettes ? Peut-il être extrait par l'utilisateur ? | non confirmé |
| Œuvres dérivées | Quantification, conversion, distillation, modèle plus petit : autorisés ? | non confirmé |
| Table texte→phonèmes et tokenizer | Mêmes droits que les poids ? Quelle source de texte du Coran (licence) ? | non confirmé |
| Données d'évaluation (benchmark) | Usage limité à l'évaluation interne : confirmé par l'accord du jeu de données ; entraînement interdit | recherche seulement |
| Durée / révocation / territoire | Permission perpétuelle ? Révocable ? Mondiale ? | non confirmé |
| Attribution | Mention exigée dans l'application et sur le produit ? | non confirmé |

## Comment l'enregistrer
Renseigner `permissions/quranlab-zipformer.json` : `evidence` (référence du courriel/accord, pas son contenu), puis chaque droit à `true`/`false`, et `conditions`. Le test `test/run-engine.ts` et `assertBuild()` refusent toute construction commerciale tant que `commercial-use` et `redistribution-weights` ne sont pas `true`.
