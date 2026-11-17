#!/usr/bin/env python3
"""
Construit tokens.txt pour sherpa-onnx à partir de phoneme_units.json (Quran-Lab).
Le format du JSON et l'identifiant du « blank » CTC ne sont PAS connus de l'auteur : le script AFFICHE la structure et exige --blank-id explicite.
  python tools/make_tokens.py phoneme_units.json --blank-id 0 --out tokens.txt     # (ex.) blank en tête, unités décalées d'1 si --shift 1
Vérifier : taille de sortie du modèle (log_probs) = nombre d'unités + 1 ; sinon l'identifiant du blank/le décalage est faux.
"""
import argparse, json, sys
p = argparse.ArgumentParser(); p.add_argument("units"); p.add_argument("--blank-id", type=int, required=True); p.add_argument("--blank-token", default="<blk>")
p.add_argument("--shift", type=int, default=0, help="ajouté à l'indice de chaque unité (1 si le blank occupe l'indice 0)"); p.add_argument("--out", default="tokens.txt")
a = p.parse_args(); j = json.load(open(a.units, encoding="utf8"))
print("type:", type(j).__name__, "| taille:", len(j), file=sys.stderr)
if isinstance(j, dict):
    print("clés (extrait):", list(j)[:8], file=sys.stderr)
    if all(isinstance(v, int) for v in j.values()): items = sorted(j.items(), key=lambda kv: kv[1])
    elif "units" in j and isinstance(j["units"], list): items = [(u, i) for i, u in enumerate(j["units"])]
    elif "id2unit" in j or "vocab" in j: d = j.get("vocab") or j["id2unit"]; items = sorted(((v, int(k)) for k, v in d.items()) if not isinstance(d, list) else [(u, i) for i, u in enumerate(d)], key=lambda x: x[1])
    else: sys.exit("Format inconnu : copiez la structure affichée ci-dessus et adaptez ce script.")
else: items = [(u, i) for i, u in enumerate(j)]
items = [(u, i + a.shift) for u, i in items]
ids = [i for _, i in items]
if a.blank_id in ids: sys.exit(f"Conflit : l'id {a.blank_id} est déjà pris par une unité ; utilisez --shift.")
rows = sorted(items + [(a.blank_token, a.blank_id)], key=lambda x: x[1])
if [i for _, i in rows] != list(range(len(rows))): sys.exit("Les identifiants ne sont pas contigus 0..N-1 : vérifier --shift / --blank-id.")
open(a.out, "w", encoding="utf8").write("\n".join(f"{u} {i}" for u, i in rows) + "\n"); print(f"{a.out} : {len(rows)} jetons (dont blank id {a.blank_id})", file=sys.stderr)
