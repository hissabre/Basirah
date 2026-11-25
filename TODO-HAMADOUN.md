# À FAIRE (Hamadoun) — novembre 2026, moteur Basirah Coran

1. Remplacez les fichiers du dépôt par ceux du zip, puis envoyez (le site se reconstruit seul, avec le modèle).
2. Ouvrez https://hissabre.github.io/Basirah/ (Chrome ou Edge), moteur « Hors ligne — Basirah Coran » (déjà choisi), Démarrer, récitez.
3. Envoyez-moi : Diagnostic → « Copier le rapport ».  Mieux encore : Diagnostic → Banc d'essai avec quelques fichiers EveryAyah (ex. 067001.mp3).

(Le workflow inspect-quran-asr-tiny n'est plus nécessaire.)

---

# À faire par Hamadoun — le strict minimum

## NOUVEAU (23/11) — débloque le modèle Quran léger
1. Remplacer les fichiers du dépôt par ceux du zip.
2. GitHub → Actions → **inspect-quran-asr-tiny** → Run workflow (≈ 3 min).
3. Télécharger l'artefact **quran-asr-tiny-spec** (zip) et me l'envoyer ici. Cela me donne les formats exacts du modèle et de vrais enregistrements de référence : je finis l'intégration sans deviner.

1. **GitHub** : remplacer les fichiers du dépôt par ceux de `basirah-core.zip`, puis Actions → *build-and-deploy* → **Run workflow** (pas « Re-run »).
2. **Un seul test réel** : ouvrir le lien, laisser « Hors ligne — Whisper », Démarrer, réciter ~30 s, **Copier le rapport** (dans « Diagnostic, micro et banc d'essai »), me le coller. C'est la première mesure réelle ; tout le reste de l'optimisation en dépend.
3. *(Optionnel, plus puissant)* **Banc d'essai** : dans Diagnostic, choisir 5 à 10 fichiers audio de versets nommés `067001.mp3` (= sourate 67, verset 1) — par ex. depuis everyayah.com — vitesse « Temps réel », Lancer, copier le rapport. Cela me donne la précision et le retard de Whisper sur de vrais récitants.

Rien d'autre n'est requis. Les moteurs en attente (Zipformer, relais, TajweedFormer) sont masqués ; `?avance=1` à la fin de l'adresse les affiche.

## Plus tard (non bloquant)
- Modèle Whisper embarqué (voir section précédente ci-dessous), clé Quran-Lab, accord écrit pour les lunettes, enregistrements pour notre propre modèle.
