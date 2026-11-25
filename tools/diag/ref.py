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
