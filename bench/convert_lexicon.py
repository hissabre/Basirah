#!/usr/bin/env python3
"""
Convertit la table texte→phonèmes de Quran-Lab en notre format de lexique :
  {"verses":[{"s":1,"a":1,"words":[["unité","unité",…],[…]]}, …]}  (6236 versets, mêmes mots que data/quran-hafs-uthmani.json)
PLACEHOLDER : la fonction `entry_to_words` doit être écrite APRÈS avoir lu la sortie de tools/inspect_quranlab_table.py ; l'auteur ne connaît pas le format.
"""
import json, sys
def entry_to_words(key, value):
    raise NotImplementedError("Écrire ici le décodage de UNE entrée (verset) en liste de mots, chaque mot = liste d'unités phonétiques.")
if __name__ == "__main__":
    src, out = sys.argv[1], sys.argv[2]; table = json.load(open(src, encoding="utf8")); verses = []
    for key, value in table.items():  # adapter l'itération au vrai format (clé = "s:a" ?)
        s, a = [int(x) for x in str(key).replace("_", ":").replace("|", ":").split(":")[:2]]
        verses.append({"s": s, "a": a, "words": entry_to_words(key, value)})
    verses.sort(key=lambda v: (v["s"], v["a"])); assert len(verses) == 6236, f"{len(verses)} versets au lieu de 6236"
    json.dump({"verses": verses}, open(out, "w", encoding="utf8"), ensure_ascii=False); print("écrit", out)
