"""
Inspecte le modèle Abdou/quran-asr-tiny (MIT) et produit tout ce qu'il faut pour l'intégrer en JavaScript SANS deviner :
 - spec.json   : noms/formes des entrées-sorties ONNX, métadonnées, options de calcul des fbank, jetons
 - golden.json : pour 3 enregistrements réels, les fbank de référence et la sortie du modèle (vérité terrain pour tester notre code JS)
 - code/       : copie des fichiers du dépôt du modèle (features.py, transcribe.py…)
 - samples/    : les 3 enregistrements (WAV 16 kHz) et leur texte
Chaque étape est protégée : si l'une échoue, le reste est quand même produit (voir report.txt).
Lancé par .github/workflows/inspect-quran-asr-tiny.yml (internet disponible chez GitHub, pas chez Claude).
"""
import json, os, sys, traceback, shutil
OUT = 'out'; os.makedirs(OUT + '/samples', exist_ok=True)
rep = []
def log(m): print(m); rep.append(str(m))
def step(name):
    def deco(fn):
        try: log(f'== {name}'); return fn()
        except Exception: log('ÉCHEC ' + name + '\n' + traceback.format_exc()); return None
    return deco

REPO = 'Abdou/quran-asr-tiny'
local = {}
@step('télécharger le dépôt du modèle (sans model.pt)')
def _():
    from huggingface_hub import snapshot_download
    p = snapshot_download(REPO, ignore_patterns=['model.pt'])
    local['p'] = p
    for r, _, fs in os.walk(p):
        for f in fs: log('  ' + os.path.relpath(os.path.join(r, f), p) + f'  {os.path.getsize(os.path.join(r, f))} o')
    if os.path.isdir(p + '/code'): shutil.copytree(p + '/code', OUT + '/code', dirs_exist_ok=True)
    for f in ('README.md', 'tokens.txt', 'transcribe.py'):
        if os.path.exists(p + '/' + f): shutil.copy(p + '/' + f, OUT + '/' + f)

spec = {}
@step('lire les entrées/sorties ONNX')
def _():
    import onnxruntime as ort
    p = local['p']; m = [f for f in os.listdir(p) if f.endswith('.onnx')]
    spec['onnx_files'] = m
    f = 'model.int8.onnx' if 'model.int8.onnx' in m else m[0]
    s = ort.InferenceSession(p + '/' + f, providers=['CPUExecutionProvider'])
    spec['file'] = f
    spec['inputs'] = [{'name': i.name, 'shape': [str(x) for x in i.shape], 'type': i.type} for i in s.get_inputs()]
    spec['outputs'] = [{'name': o.name, 'shape': [str(x) for x in o.shape], 'type': o.type} for o in s.get_outputs()]
    spec['metadata'] = dict(s.get_modelmeta().custom_metadata_map)
    spec['ops'] = sorted({n.op_type for n in __import__('onnx').load(p + '/' + f).graph.node}) if True else []
    local['sess'] = s; log(json.dumps(spec, ensure_ascii=False, indent=1))

@step('jetons')
def _():
    toks = [l.rstrip('\n').split(' ') for l in open(local['p'] + '/tokens.txt', encoding='utf8')]
    spec['tokens'] = toks; log(f'{len(toks)} jetons : ' + ' | '.join(' '.join(t) for t in toks))

feat_opts = None
@step('fbank de référence (kaldi-native-fbank, réglages par défaut de sherpa-onnx)')
def _():
    global feat_opts
    import kaldi_native_fbank as knf
    o = knf.FbankOptions(); o.frame_opts.dither = 0; o.frame_opts.snip_edges = False; o.frame_opts.samp_freq = 16000
    o.mel_opts.num_bins = 80; o.mel_opts.high_freq = -400; o.mel_opts.low_freq = 20
    feat_opts = o
    spec['fbank'] = {'num_bins': 80, 'frame_length_ms': 25, 'frame_shift_ms': 10, 'dither': 0, 'snip_edges': False, 'low_freq': 20, 'high_freq': -400,
                     'window': 'povey', 'preemph': 0.97, 'remove_dc': True, 'note': "à confirmer avec code/quran_asr/features.py ; golden.json dit si ces réglages reproduisent le modèle"}

samples = []
@step('3 enregistrements réels (tarteel-ai/everyayah, flux)')
def _():
    import numpy as np, soundfile as sf
    from datasets import load_dataset, Audio
    ds = load_dataset('tarteel-ai/everyayah', split='test', streaming=True).cast_column('audio', Audio(sampling_rate=16000))
    for i, ex in enumerate(ds):
        a = np.asarray(ex['audio']['array'], dtype='float32')
        if len(a) / 16000 > 12: continue
        n = f'sample{len(samples)}'; sf.write(f'{OUT}/samples/{n}.wav', a, 16000)
        samples.append({'name': n, 'text': ex.get('text', ''), 'sec': len(a) / 16000, 'wave': a})
        if len(samples) >= 3 or i > 200: break
    log(f'{len(samples)} enregistrements')

golden = []
@step('référence : fbank + sortie du modèle + texte décodé (sherpa-onnx)')
def _():
    import numpy as np, kaldi_native_fbank as knf
    sess = local['sess']; toks = [t[0] for t in spec['tokens']]
    try:
        import sherpa_onnx
        rec = sherpa_onnx.OfflineRecognizer.from_zipformer_ctc(model=local['p'] + '/' + spec['file'], tokens=local['p'] + '/tokens.txt', num_threads=1)
    except Exception: rec = None; log('sherpa_onnx indisponible : ' + traceback.format_exc())
    for s in samples:
        w = s['wave']; res = {'name': s['name'], 'text': s['text'], 'sec': s['sec']}
        for scale in (1.0, 32768.0):
            fb = knf.OnlineFbank(feat_opts); fb.accept_waveform(16000, (w * scale).tolist()); fb.input_finished()
            F = np.stack([fb.get_frame(i) for i in range(fb.num_frames_ready)]).astype('float32')
            names = [i['name'] for i in spec['inputs']]
            lp = sess.run(None, {names[0]: F[None], names[1]: np.array([F.shape[0]], dtype='int64')})
            ids = lp[0][0].argmax(-1).tolist(); out, prev = [], -1
            for t in ids:
                if t != prev and t != 0: out.append(toks[t] if t < len(toks) else '?')
                prev = t
            res[f'scale_{int(scale)}'] = {'frames': int(F.shape[0]), 'decoded_greedy': ''.join(out)}
            if scale == 1.0: res['fbank_shape'] = list(F.shape); res['fbank_first_frames'] = F[:5].round(4).tolist(); res['fbank_mean_std'] = [float(F.mean()), float(F.std())]; res['logprobs_argmax'] = ids
            if scale == 32768.0: res['fbank32768_mean_std'] = [float(F.mean()), float(F.std())]
        if rec is not None:
            st = rec.create_stream(); st.accept_waveform(16000, w); rec.decode_stream(st); res['sherpa_text'] = st.result.text
        golden.append(res); log(json.dumps({k: v for k, v in res.items() if k not in ('logprobs_argmax', 'fbank_first_frames')}, ensure_ascii=False))

json.dump(spec, open(OUT + '/spec.json', 'w'), ensure_ascii=False, indent=1)
json.dump(golden, open(OUT + '/golden.json', 'w'), ensure_ascii=False)
open(OUT + '/report.txt', 'w', encoding='utf8').write('\n'.join(rep))
