# Phase 1 — Audit du code de reconnaissance (Basirah-test.html)

Fichier inspecté : script principal (~73 000 caractères de logique, hors données Coran intégrées).
Tout ce qui suit est tiré de la lecture du code. Les **causes** des coupures micro et de la latence sont des **hypothèses fortes déduites du code**, pas des mesures : elles seront confirmées en Phase 2 par la capture instrumentée sur appareil.

## 1. Ce qui existe : cinq chemins de reconnaissance concurrents
| # | Chemin | Où | Problème |
|---|---|---|---|
| 1 | Moteur natif (whisper.cpp via `window.Native`) | app Android | Seul chemin proche d'une bonne architecture (micro natif, file séparée). Gardé pour la phase native. |
| 2 | `SpeechRecognition` local (`processLocally`) | `srToggle(true)` | Dépend du navigateur et de langues téléchargeables ; non fiable comme moteur principal. |
| 3 | `SpeechRecognition` en ligne (service du navigateur) | `srToggle(false)` | Le son part chez le fournisseur du navigateur ; qualité non contrôlée. |
| 4 | Whisper via transformers.js dans un Worker | `startWhisper/WK` | Voir §3. |
| 5 | Démo simulée | bouton Démo | Utile pour l'interface, à isoler des moteurs réels. |

`pickEngine()` choisit **silencieusement** local → en ligne → Whisper selon la disponibilité : l'utilisateur ne sait pas quel moteur écoute (contraire à la règle « pas de bascule silencieuse »).

## 2. Cause probable des coupures micro (Chrome/Edge)
`rec.onend = () => { … if (srOn) rec.start() }` : à chaque fin de session `SpeechRecognition` (silence, limite de durée, erreur réseau), le code **redémarre aveuglément**, sans limite, sans journal de cause, sans état. Chaque redémarrage rouvre une session micro ; selon le contexte (page `file://`, HTTP, onglet masqué) cela peut ré-afficher la demande d'autorisation ou être refusé. `onerror` ignore `no-speech` et ne distingue pas réseau / micro / service. → coupures « inexpliquées » et boucles de redémarrage.

## 3. Causes probables de la latence (chemin Whisper navigateur)
- `createScriptProcessor(4096)` : **obsolète**, s'exécute sur le fil principal, stocke chaque bloc dans un tableau JS non borné entre deux ticks.
- `setInterval(tick, 2000)` : toutes les 2 s, **tout le tampon récent (jusqu'à 28 s) est recopié et renvoyé** au modèle. La fenêtre s'allonge quand l'appareil est lent (`keep = latence+3 s`) → le travail par tick augmente exactement quand la machine est en retard : spirale de latence.
- Pas de contre-pression réelle : `busy` est remis à `false` après 30 s **par un temporisateur arbitraire** alors que l'inférence peut encore tourner → traitements dupliqués possibles.
- `spawnW()` a trois replis (Worker module → Worker classique → **exécution sur le fil principal** « mode compatibilité ») : l'interface peut se figer, et l'état réel est peu lisible.
- Modèle : `Xenova/whisper-base` **générique**, `language:'arabic'`, décodage glouton : non spécialisé Coran.
- Rustines : gain jusqu'à ×40 sur audio faible (amplifie le bruit), filtre anti-boucle `loopy`, rejet des textes « pas du Coran » (`U.has`) **avant** l'alignement — ce dernier filtre rend ce chemin inutilisable pour le mode Traduction (non-Coran).
- Fusion de fenêtres chevauchantes (`addWin`) par recherche heuristique de recouvrement (`sim ≥ 0,7`) : fragile ; une erreur de fusion injecte des mots dupliqués ou perdus dans `acc`.

## 4. Moteur d'appariement existant (`step/glob/feedQ`)
**Bonnes idées à conserver** : faisceau d'hypothèses, attente séquentielle (mot suivant favorisé), recherche globale par n-grammes pour se retrouver, anti-ambiguïté entre versets proches (`SIMV`), instantanés pour recalcul incrémental, formules de prière (`PH`) hors Coran.
**Problèmes** :
- Variables globales partagées (`words, snaps, last, prayer, acc…`) ; appels DOM (`$('st')`, `render`) **à l'intérieur** de la logique de match → impossible à tester seul.
- Seuils magiques (`GATE=2.7`, `th`, `.88`, `.6`…) sans mesure ; **aucune confiance exposée** ; affichage dépend d'un seuil unique (pas de confirmation en deux temps).
- Reçoit le texte **cumulé entier** à chaque fois : toute révision d'un mot ancien invalide les instantanés.

## 5. États, erreurs, structure
- Pas de machine d'états de reconnaissance : l'état est du texte écrit dans `#st` ; variables `srOn`, `wOn`, `nOn`, `busy`, `ready` dupliquent l'état.
- Pas de journal des interruptions ni de limite de reprises.
- Mode Traduction : câblé seulement sur `SpeechRecognition` (`__tradLive`) ; traduction par l'API `Translator` de Chrome ou **MyMemory** (service en ligne tiers, texte coupé à 240 caractères) — qualité et confidentialité non maîtrisées.
- Un seul fichier de 3,4 Mo (polices et Coran embarqués) avec interface, moteurs et données mêlés.

## 6. Données Coran
6 236 versets Tanzil Uthmani (Hafs), numérotation vérifiée, texte jamais modifié. **Warsh : absent.** Pas de segmentation temporelle par mot. Traductions : Tanzil (licence non commerciale).

## 7. Décisions
| Élément | Décision |
|---|---|
| Données Coran, vérification d'intégrité, normalisation | **Conservé** (déplacé dans `QuranDB`) |
| Idée faisceau + n-grammes + anti-ambiguïté | **Conservé, réécrit** (`Aligner`, testable, sans DOM) |
| Formules de prière `PH` | À reprendre en Phase 5 comme module séparé |
| Thèmes, interface, sessions | Conservés ; branchés au nouveau noyau en Phase 5 |
| Choix automatique local→en ligne→Whisper | **Supprimé** : un moteur explicite, état visible |
| ScriptProcessor, tick 2 s, fenêtres chevauchantes, `addWin`, temporisateur 30 s, repli sur fil principal, redémarrage infini de `SpeechRecognition` | **Supprimés** |
| Filtre « Coran seulement » dans le chemin de reconnaissance | **Supprimé** (l'alignement décide, pas un filtre) ; Traduction = pipeline séparé |
