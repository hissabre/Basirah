/** Contrôles de COHÉRENCE du calcul fbank (pas une comparaison à la référence du modèle : voir golden.json). */
import { Fbank, DEFAULT_FBANK } from '../src/audio/fbank.ts';
let pass = 0, fail = 0;
const t = (n: string, ok: boolean, i = '') => { ok ? pass++ : fail++; console.log((ok ? '  ✓ ' : '  ✗ ') + n + (i ? '  — ' + i : '')); };
const fb = new Fbank();
console.log('\n[Fbank — contrôles de cohérence]');
t('nombre d\'images = (N + 80) / 160 (bords non coupés) : 1 s → 100', fb.numFrames(16000) === 100, String(fb.numFrames(16000)));
t('3,5 s → 350 images', fb.numFrames(56000) === 350);
const sil = fb.compute(new Float32Array(16000)); const floor = Math.log(DEFAULT_FBANK.eps);
t('silence numérique → toutes les valeurs = log(epsilon)', sil.every(v => Math.abs(v - floor) < 1e-4), floor.toFixed(2));
for (const f of [300, 1000, 3000]) {
  const x = new Float32Array(16000); for (let i = 0; i < x.length; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * f * i / 16000);
  const o = fb.compute(x), T = o.length / 80, mid = Math.floor(T / 2); let best = 0; for (let b = 1; b < 80; b++) if (o[mid * 80 + b] > o[mid * 80 + best]) best = b;
  const m = (hz: number) => 1127 * Math.log(1 + hz / 700), pos = (m(f) - m(20)) / ((m(7600) - m(20)) / 81) - 1;
  t(`sinusoïde ${f} Hz → bande dominante proche de ${pos.toFixed(1)}`, Math.abs(best - pos) <= 1.5, 'bande ' + best);
}
const loud = new Float32Array(16000).fill(0).map((_, i) => Math.sin(i / 7)), quiet = loud.map(v => v * 0.1);
const a = fb.compute(loud), b = fb.compute(quiet); let d = 0, c = 0; for (let fr = 10; fr < 80; fr++) for (let k = 9; k <= 12; k++) { d += a[fr * 80 + k] - b[fr * 80 + k]; c++; }
t('10× plus faible → log-énergie plus basse de ≈ 2·ln 10 ≈ 4,6', Math.abs(d / c - 4.6) < 0.3, (d / c).toFixed(2));
const x = new Float32Array(48000).map(() => Math.random() - 0.5); const t0 = performance.now(); fb.compute(x);
t('3 s d\'audio calculées en < 50 ms (Node)', performance.now() - t0 < 50, (performance.now() - t0).toFixed(1) + ' ms');
console.log(`\n${pass} réussis, ${fail} échoués  (cohérence interne ; non comparé à la référence du modèle)`); process.exit(fail ? 1 : 0);
