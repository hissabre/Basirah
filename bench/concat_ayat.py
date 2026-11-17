#!/usr/bin/env python3
"""
Construit une récitation CONTINUE de test à partir de fichiers verset par verset (ex. EveryAyah) d'un même récitant, avec heures exactes
par verset. Les fichiers sources doivent être autorisés pour l'évaluation interne. Les jonctions sont artificielles (pas de liaison naturelle) :
c'est utile pour vérifier le suivi avec une vérité exacte, PAS pour mesurer le comportement d'un vrai imam.
  python bench/concat_ayat.py --surah 67 --from 1 --to 12 --dir /audio/reciterX --pattern "{s:03d}{a:03d}.wav" --gap 0.3 --out /audio/mulk.wav --json mulk.times.json
"""
import argparse, json
import numpy as np, soundfile as sf

p = argparse.ArgumentParser()
p.add_argument("--surah", type=int, required=True); p.add_argument("--from", dest="a0", type=int, required=True); p.add_argument("--to", dest="a1", type=int, required=True)
p.add_argument("--dir", required=True); p.add_argument("--pattern", default="{s:03d}{a:03d}.wav"); p.add_argument("--gap", type=float, default=0.3)
p.add_argument("--out", required=True); p.add_argument("--json", required=True)
a = p.parse_args()
parts, times, t, sr0 = [], [], 0.0, None
for ay in range(a.a0, a.a1 + 1):
    x, sr = sf.read(f"{a.dir}/{a.pattern.format(s=a.surah, a=ay)}", dtype="float32", always_2d=True); x = x.mean(axis=1)
    if sr0 is None: sr0 = sr
    assert sr == sr0, "taux d'échantillonnage différents"
    times.append(dict(surah=a.surah, ayah=ay, startSec=round(t, 3), endSec=round(t + len(x) / sr, 3)))
    parts += [x, np.zeros(int(a.gap * sr), dtype="float32")]; t += len(x) / sr + a.gap
sf.write(a.out, np.concatenate(parts), sr0)
json.dump(dict(ayahTimes=times, durationSec=round(t, 3)), open(a.json, "w"), indent=2)
print(f"{a.out} : {t:.1f} s, {len(times)} versets")
