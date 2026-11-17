#!/usr/bin/env python3
"""
Génère, pour les 6236 versets, les phonèmes ATTENDUS avec règles de tajweed, via `quranic-phonemizer` (licence MIT, QUD-Technologies).
Exécuté AUTOMATIQUEMENT par GitHub Actions (.github/workflows/generate-phonemes.yml) : vous n'avez rien à lancer.
API utilisée d'après la page PyPI : Phonemizer().analyse("s:a") → .phonemes(), .document() (JSON). NON TESTÉ localement (pas de réseau dans l'environnement de développement).
Sortie : phonemes-hafs.json = [{s, a, phonemes, document}] — le format réel du document sera lu au premier retour, puis converti en lexique d'alignement.
"""
import json, sys, importlib
mod = None
for name in ("quranic_phonemizer", "quranic_phonemiser", "quran_phonemizer"):
    try: mod = importlib.import_module(name); break
    except ImportError: continue
if mod is None: sys.exit("Module introuvable : vérifier le nom d'import du paquet quranic-phonemizer.")
Phonemizer = mod.Phonemizer; ph = Phonemizer()
verses = json.load(open("data/quran-hafs-uthmani.json", encoding="utf8"))["verses"]
out, errors = [], []
for s, a, _ in verses:
    try:
        r = ph.analyse(f"{s}:{a}")
        out.append({"s": s, "a": a, "phonemes": r.phonemes(), "document": r.document()})
    except Exception as e:  # on continue : le nombre d'échecs est rapporté
        errors.append({"s": s, "a": a, "error": repr(e)})
json.dump({"source": "quranic-phonemizer (MIT)", "version": getattr(mod, "__version__", None), "verses": out, "errors": errors}, open("phonemes-hafs.json", "w", encoding="utf8"), ensure_ascii=False)
print(f"{len(out)} versets, {len(errors)} erreurs");
if out: print("exemple 1:1 →", out[0]["phonemes"])
