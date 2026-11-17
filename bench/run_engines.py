#!/usr/bin/env python3
"""
Banc d'essai : exécute un moteur sur les enregistrements d'un manifeste et écrit un fichier JSONL par enregistrement
(un résultat par ligne : unit, text, tokens, audioStart, audioEnd, isFinal, wall). L'évaluation (WER/CER/PER/suivi) est faite
ensuite par src/eval/cli.ts, avec EXACTEMENT les mêmes enregistrements pour les deux moteurs.

AUCUN téléchargement d'audio ici. Seuls les enregistrements dont la licence autorise `internal-evaluation` sont traités.
NON EXÉCUTÉ dans l'environnement de développement (pas d'accès aux paquets/modèles) : à lancer sur la machine de test.

  Zipformer :  python bench/run_engines.py --manifest dataset/manifest.json --audio-root /chemin/audio --engine zipformer \
               --model quran_phoneme_zipformer.int8.onnx --tokens tokens.txt --out out/zipformer --threads 2
  Whisper   :  python bench/run_engines.py --manifest dataset/manifest.json --audio-root /chemin/audio --engine whisper-quran \
               --hf-model tarteel-ai/whisper-base-ar-quran --out out/whisper-quran
"""
import argparse, json, os, sys, time
import numpy as np
import soundfile as sf

CHUNK_SEC = 0.1  # taille de bloc de lecture simulant le micro (aucun regroupement en fenêtres)

def load16k(path):
    x, sr = sf.read(path, dtype="float32", always_2d=True)
    x = x.mean(axis=1)
    if sr != 16000:
        n = int(round(len(x) * 16000 / sr))
        x = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype("float32")  # rééchantillonnage linéaire (simple) — préférer des fichiers déjà en 16 kHz
    return x

def allowed(rec):
    lic = rec.get("licence", {})
    return bool(lic.get("evidence")) and lic.get("uses", {}).get("internal-evaluation") is True and lic.get("status") != "denied"

def run_zipformer(a, x):
    import sherpa_onnx
    rec = sherpa_onnx.OnlineRecognizer.from_zipformer2_ctc(
        tokens=a.tokens, model=a.model, num_threads=a.threads, sample_rate=16000, feature_dim=80,
        decoding_method="greedy_search", enable_endpoint_detection=True,
        rule1_min_trailing_silence=2.4, rule2_min_trailing_silence=1.2, rule3_min_utterance_length=20)
    s = rec.create_stream(); n = int(CHUNK_SEC * 16000); out = []; seg_start = 0.0; last = []
    t0 = time.perf_counter()
    for i in range(0, len(x), n):
        s.accept_waveform(16000, x[i:i + n])
        while rec.is_ready(s):
            rec.decode_stream(s)
        r = rec.get_result_all(s) if hasattr(rec, "get_result_all") else None
        toks = list(r.tokens) if r is not None else []
        text = r.text if r is not None else rec.get_result(s)
        end = min(len(x), i + n) / 16000
        ep = rec.is_endpoint(s)
        if toks != last or ep:
            out.append(dict(unit="phoneme", text=text, tokens=toks, audioStart=seg_start, audioEnd=end, isFinal=bool(ep), wall=time.perf_counter() - t0))
            last = toks
        if ep:
            rec.reset(s); seg_start = end; last = []
    return out, time.perf_counter() - t0

_whisper = {}
def run_whisper(a, x):
    from transformers import pipeline
    if "p" not in _whisper:
        _whisper["p"] = pipeline("automatic-speech-recognition", model=a.hf_model, chunk_length_s=30)
    t0 = time.perf_counter()
    r = _whisper["p"]({"raw": x, "sampling_rate": 16000}, return_timestamps=True, generate_kwargs={"language": "arabic", "task": "transcribe"})
    wall = time.perf_counter() - t0
    out = []
    for c in r.get("chunks", [{"text": r["text"], "timestamp": (0.0, len(x) / 16000)}]):
        st, en = c["timestamp"]
        out.append(dict(unit="text", text=c["text"], audioStart=st or 0.0, audioEnd=en or len(x) / 16000, isFinal=True, wall=wall))
    return out, wall

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--manifest", required=True); p.add_argument("--audio-root", required=True); p.add_argument("--out", required=True)
    p.add_argument("--engine", choices=["zipformer", "whisper-quran"], required=True)
    p.add_argument("--model"); p.add_argument("--tokens"); p.add_argument("--threads", type=int, default=2); p.add_argument("--hf-model", default="tarteel-ai/whisper-base-ar-quran")
    a = p.parse_args(); os.makedirs(a.out, exist_ok=True)
    man = json.load(open(a.manifest, encoding="utf8")); perf = []
    for rec in man["recordings"]:
        if not allowed(rec):
            print(f"IGNORÉ {rec['id']} : licence n'autorise pas l'évaluation interne", file=sys.stderr); continue
        path = os.path.join(a.audio_root, rec["audio"])
        if not os.path.exists(path):
            print(f"ABSENT {rec['id']} : {path}", file=sys.stderr); continue
        x = load16k(path); res, wall = (run_zipformer if a.engine == "zipformer" else run_whisper)(a, x)
        with open(os.path.join(a.out, rec["id"] + ".jsonl"), "w", encoding="utf8") as f:
            for r in res: f.write(json.dumps(r, ensure_ascii=False) + "\n")
        dur = len(x) / 16000; perf.append(dict(id=rec["id"], audioSec=dur, wallSec=wall, rtf=wall / dur))
        print(f"{rec['id']}: {dur:.1f}s audio en {wall:.1f}s (RTF {wall/dur:.2f})")
    json.dump(dict(engine=a.engine, perf=perf), open(os.path.join(a.out, "_perf.json"), "w"), indent=2)

if __name__ == "__main__":
    main()
