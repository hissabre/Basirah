// Même calcul que la page (StreamingFbank + fenêtres glissantes du moteur) avec onnxruntime-node, comparé à la référence.
import { readFileSync } from 'node:fs';
import * as ort from 'onnxruntime-node';
import { StreamingFbank } from '../../src/audio/fbank.ts';
const [M, T, ...files] = process.argv.slice(2);
const toks: string[] = []; for (const l of readFileSync(T, 'utf8').split('\n')) { const m = /^(.*?)\s*(\d+)\s*$/.exec(l); if (m) toks[+m[2]] = m[1] || ' '; }
const s = await ort.InferenceSession.create(M);
async function run(x: Float32Array, n: number) { const r = await s.run({ x: new ort.Tensor('float32', x, [1, n, 80]), x_lens: new ort.Tensor('int64', BigInt64Array.from([BigInt(n)]), [1]) }); const lp = r.log_probs; return { a: lp.data as Float32Array, n: lp.dims[1], V: lp.dims[2] }; }
const greedy = (o: { a: Float32Array; n: number; V: number }, from = 0, to = o.n, prev = { g: -1 }) => { let t = ''; for (let k = from; k < to; k++) { let g = 0; for (let i = 1; i < o.V; i++) if (o.a[k * o.V + i] > o.a[k * o.V + g]) g = i; if (g && g !== prev.g) t += toks[g] === '▁' ? ' ' : toks[g]; prev.g = g; } return t; };
for (const f of files) {
  const pcm = new Float32Array(readFileSync(f).buffer.slice(0));
  const fb = new StreamingFbank(); for (let i = 0; i < pcm.length; i += 1600) fb.push(pcm.subarray(i, i + 1600));
  const F = fb.slice(0, fb.framesDone), K = new Float32Array(readFileSync(f + '.knf').buffer.slice(0));
  let md = 0, mm = 0, n = Math.min(F.length, K.length); for (let i = 0; i < n; i++) { const d = Math.abs(F[i] - K[i]); md = Math.max(md, d); mm += d; }
  const full = await run(F, fb.framesDone);
  // fenêtres glissantes comme le moteur : 2,4 s, pas 0,24 s, marge 0,12 s
  let win = '', last = -1, prev = { g: -1 }; const W = 240;
  for (let end = 50; end <= fb.framesDone; end += 24) { const st = Math.max(0, end - W), o = await run(fb.slice(st, end), end - st), dt = (end - st) / o.n;
    let k0 = o.n; for (let k = 0; k < o.n; k++) { const t = st + (k + 0.5) * dt; if (t > last && t <= end - 12) { k0 = Math.min(k0, k); } }
    let k1 = k0; while (k1 < o.n && st + (k1 + 0.5) * dt <= end - 12) k1++; if (k1 > k0) { win += greedy(o, k0, k1, prev); last = st + (k1 - 0.5) * dt; } }
  console.log(`\n${f}\n  fbank page vs knf : écart max ${md.toFixed(3)}, moyen ${(mm / n).toFixed(4)} (${fb.framesDone} vs ${K.length / 80} images)\n  page, fichier entier : ${greedy(full)}\n  page, fenêtres 2,4 s : ${win}`);
}
