# Plateformes : Android, iOS, tablettes, lunettes

Le cœur (alignement, Stabilizer, Session, Hifz, traduction, licences) est du TypeScript sans dépendance de plateforme. Seules trois choses changent : la **source audio**, la **fabrique de moteurs**, le **stockage** (`src/platform/ports.ts`). `Basirah` (`src/app/basirah.ts`) assemble le tout.

| Plateforme | Audio | Hors ligne | En ligne | État |
|---|---|---|---|---|
| Navigateur / PWA | `BrowserAudioSource` (AudioWorklet) | ONNX Runtime Web/WASM à écrire (non fait) | `WebSocketProvider` → relais | code présent, non testé sur voix réelle |
| Android / iOS / tablette | micro natif via pont (Capacitor/WebView) | sherpa-onnx natif (Android/iOS existent) derrière `EngineHandle` | identique | **à écrire** ; aucun code natif n'existe |
| Lunettes Basirah | micro/SoC du fabricant | sherpa-onnx natif si le SoC le permet | identique | dépend du matériel choisi |

Règles communes : un seul flux micro, choix de moteur explicite, aucune bascule silencieuse, même moteur d'alignement partout. Les performances (RTF < 1) doivent être mesurées sur chaque appareil cible ; aucune mesure n'existe.
