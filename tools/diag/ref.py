# Référence officielle (sherpa-onnx + kaldi-native-fbank) pour comparer avec le moteur de la page.
import sys, numpy as np, kaldi_native_fbank as knf, onnxruntime as ort, sherpa_onnx
M, T = sys.argv[1], sys.argv[2]; files = sys.argv[3:]
toks = {int(l.split()[-1]): (l.rsplit(' ',1)[0] if l.strip().split()[0] != l.strip() else ' ') for l in open(T, encoding='utf8') if l.strip()}
rec = sherpa_onnx.OfflineRecognizer.from_zipformer_ctc(model=M, tokens=T, num_threads=2)
sess = ort.InferenceSession(M)
print('IO', [(i.name, i.shape, i.type) for i in sess.get_inputs()], [(o.name, o.shape) for o in sess.get_outputs()])
for f in files:
    x = np.fromfile(f, dtype=np.float32)
    s = rec.create_stream(); s.accept_waveform(16000, x); rec.decode_stream(s)
    o = knf.FbankOptions(); o.frame_opts.dither = 0; o.frame_opts.snip_edges = False; o.mel_opts.num_bins = 80; o.mel_opts.high_freq = -400
    fb = knf.OnlineFbank(o); fb.accept_waveform(16000, x.tolist()); fb.input_finished()
    F = np.stack([fb.get_frame(i) for i in range(fb.num_frames_ready)]).astype(np.float32); F.tofile(f + '.knf')
    lp = sess.run(None, {sess.get_inputs()[0].name: F[None], sess.get_inputs()[1].name: np.array([len(F)], dtype=np.int64)})[0][0]
    g = lp.argmax(-1); txt = ''.join(toks[int(v)] for i, v in enumerate(g) if v != 0 and (i == 0 or v != g[i-1])).replace('▁', ' ')
    print(f'\n{f}\n  sherpa : {s.result.text}\n  knf+ort: {txt}\n  frames {len(F)} -> {lp.shape}  mean max p {np.exp(lp.max(-1)).mean():.3f}')

# ── Fbank de la PAGE : fichier entier puis fenêtres glissantes comme le moteur ──
def greedy(lp, prev=-1):
    t = ''
    for v in lp.argmax(-1):
        if v != 0 and v != prev: t += toks[int(v)]
        prev = v
    return t.replace('▁', ' '), prev
for f in files:
    P = np.fromfile(f + '.page', dtype=np.float32).reshape(-1, 80); K = np.fromfile(f + '.knf', dtype=np.float32).reshape(-1, 80)
    n = min(len(P), len(K)); d = np.abs(P[:n] - K[:n])
    print(f'\n{f}\n  fbank page vs knf : écart max {d.max():.3f} moyen {d.mean():.4f} ({len(P)} vs {len(K)} images); par bande max: {np.round(d.max(0)[[0,1,2,40,78,79]],3)}')
    run = lambda X: sess.run(None, {sess.get_inputs()[0].name: X[None], sess.get_inputs()[1].name: np.array([len(X)], dtype=np.int64)})[0][0]
    print('  page, fichier entier :', greedy(run(P))[0])
    for W, G in [(240, 12), (400, 12), (240, 40)]:
        out, last, prev = '', -1.0, -1
        for end in range(50, len(P) + 1, 24):
            st = max(0, end - W); lp = run(P[st:end]); dt = (end - st) / len(lp)
            ks = [k for k in range(len(lp)) if st + (k + .5) * dt > last and st + (k + .5) * dt <= end - G]
            if ks: t, prev = greedy(lp[ks[0]:ks[-1] + 1], prev); out += t; last = st + (ks[-1] + .5) * dt
        print(f'  page, fenêtres {W/100:.1f} s marge {G/100:.2f} s :', out)

# ── Variantes de découpage : contexte long + silence ajouté à droite ──
import time
def ed(a, b):
    p = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        c = [i] + [0] * len(b)
        for j, y in enumerate(b, 1): c[j] = min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (x != y))
        p = c
    return p[-1]
for f in files:
    P = np.fromfile(f + '.page', dtype=np.float32).reshape(-1, 80); ref = greedy(run(P))[0].replace(' ', '')
    print(f'\n{f}  référence: {ref}')
    for W, pad, G in [(1200, 0, 40), (1200, 0, 24), (1200, 30, 12), (1200, 50, 0), (600, 50, 12), (1200, 80, 12), (2000, 50, 12)]:
        out, last, prev, tm, nr = '', -1.0, -1, 0.0, 0
        sil = np.full((pad, 80), np.log(1.1920929e-7), np.float32) + 0  # niveau plancher
        for end in range(50, len(P) + 1, 24):
            st = max(0, end - W); X = np.concatenate([P[st:end], sil]) if pad else P[st:end]
            t0 = time.time(); lp = run(X); tm += time.time() - t0; nr += 1
            dt = len(X) / len(lp)
            ks = [k for k in range(len(lp)) if st + (k + .5) * dt > last and st + (k + .5) * dt <= end - G]
            if ks: t, prev = greedy(lp[ks[0]:ks[-1] + 1], prev); out += t; last = st + (ks[-1] + .5) * dt
        o = out.replace(' ', '')
        print(f'  W {W/100:4.1f}s pad {pad/100:.2f}s marge {G/100:.2f}s  erreurs {ed(o, ref):3d}/{len(ref)}  passe {1000*tm/nr:5.1f} ms  : {out}')
