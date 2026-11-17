#!/usr/bin/env python3
"""Affiche la structure de quran_text2phoneme.json (format inconnu de l'auteur) pour écrire le convertisseur vers notre format de lexique."""
import json, sys
j = json.load(open(sys.argv[1], encoding="utf8"))
def show(x, d=0, key="racine"):
    pad = "  " * d
    if isinstance(x, dict): print(f"{pad}{key}: dict({len(x)}) clés ex.: {list(x)[:5]}"); [show(v, d + 1, k) for k, v in list(x.items())[:2] if d < 3]
    elif isinstance(x, list): print(f"{pad}{key}: list({len(x)})"); [show(v, d + 1, "[0]") for v in x[:1] if d < 3]
    else: print(f"{pad}{key}: {type(x).__name__} = {str(x)[:80]!r}")
show(j)
