# Architecture cible

```
AudioCapture (1 micro, AudioWorklet, tampon borné)
   │ blocs PCM 16 kHz
   ▼
RecognitionEngine (interface commune)  ── Online | Offline | Replay(test)
   │ RecognitionResult {text, isFinal, audioStart/End, confidence|null, engineId}
   ▼
Stabilizer (accord local → mots confirmés, ajout seul)
   ▼
Aligner (QuranDB, profil prayer|hifz|reading) ── position confirmée, confiance, événements
   ▼
Session (état + FSM de reconnaissance + journal)  →  Interface  +  Diagnostics
```
Mode Traduction : même capture + moteur, puis pipeline séparé (transcription générale → traduction), sans filtre Coran.

## Modules (dossier `src/`)
| Module | Fichier | État |
|---|---|---|
| Types / contrat moteur | `types.ts` | écrit, vérifié par le compilateur |
| Base du Coran | `quran/db.ts`, `quran/normalize.ts` | écrit + testé |
| Alignement | `align/aligner.ts` | écrit + testé (simulation) |
| Stabilisateur | `align/stabilizer.ts` | écrit + testé |
| Machine d'états | `engine/state-machine.ts` | écrit + testé |
| Tampon borné | `audio/ringbuffer.ts` | écrit + testé |
| Capture audio | `audio/capture.ts` | écrit, **non testé** (pas de micro ici) |
| Moteurs en ligne / hors ligne | — | **Phase 3, pas commencé** |
| Traduction | — | pas commencé |
| Session / diagnostics / branchement à l'interface | — | Phase 5 |

## Partage vers Android / iOS / lunettes (Phase 7)
- **Partageable tel quel** (TypeScript pur, sans DOM) : `QuranDB`, `Aligner`, `Stabilizer`, FSM.
- **Natif par plateforme** : capture micro, moteur hors ligne (whisper.cpp / ONNX), énergie, permissions.
- Recommandation : interface web actuelle dans une coque (Capacitor ou WebView) avec plugins natifs audio + ASR, le noyau TS tournant dans la vue web ; sur les lunettes, même noyau dans le moteur JS embarqué. Compromis : une seule base de code et des tests partagés, contre une latence JS légèrement supérieure à du natif pur (l'alignement mesuré ici prend < 1 ms par mot, donc non limitant). À réévaluer si une plateforme interdit le JS embarqué.
