/**
 * Chaîne complète du moteur Coran, avec un modèle SIMULÉ (aucun vrai modèle, aucune vraie voix) :
 * micro (PCM) → fbank en flux → fenêtres glissantes → « modèle » → images CTC → session → suivi dans le texte du Coran.
 * Le faux modèle émet, pour chaque image, la lettre réellement « récitée » à cet instant, avec erreurs (substitutions, oublis, pics faibles).
 * Mesure : verset trouvé ? retard (temps audio) entre la récitation d'un mot et sa position confirmée.
 */
import { readFileSync } from 'node:fs';
import { QuranDB } from '../src/quran/db.ts';
import { Session } from '../src/session/session.ts';
import { QuranCtcEngine, parseTokens } from '../src/engine/quran-ctc.ts';
import { StreamingFbank, Fbank } from '../src/audio/fbank.ts';
import { buildLetterCorpus } from '../src/quran/letters.ts';

const q = new QuranDB(JSON.parse(readFileSync(new URL('../data/quran-hafs-uthmani.json', import.meta.url), 'utf8')));
let pass = 0, fail = 0;
const t = (n: string, ok: boolean, i = '') => { ok ? pass++ : fail++; console.log((ok ? '  ✓ ' : '  ✗ ') + n + (i ? '  — ' + i : '')); };

console.log('\n[Fbank en flux]');
{ const pcm = new Float32Array(16000 * 2).map((_, i) => Math.sin(i * 0.05) * 0.3 + Math.sin(i * 0.31) * 0.1);
  const a = new Fbank().compute(pcm), s = new StreamingFbank(); for (let i = 0; i < pcm.length; i += 1600) s.push(pcm.subarray(i, i + 1600));
  const b = s.slice(0, s.framesDone); let m = 0; for (let i = 0; i < b.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  t('identique au calcul hors flux (bords compris)', m < 1e-4 && s.framesDone >= 197, `écart max ${m.toExponential(1)}, ${s.framesDone} images`); }

// Vocabulaire au format sherpa-onnx, tel que décrit par la fiche du modèle (29 lettres + séparateur + blanc). Le vrai fichier est lu à l'exécution.
const LET = 'ءابتثجحخدذرزسشصضطظعغفقكلمنهوي';
const TOK = ['<blk> 0', '▁ 1', ...[...LET].map((c, i) => `${c} ${i + 2}`)].join('\n');
const vocab = parseTokens(TOK);
console.log('\n[Jetons]');
t('blanc, séparateur fondu, 31 symboles', vocab.blank === 0 && vocab.fold.join() === '1' && vocab.tokens.length === 31);
const id = new Map(vocab.tokens.map((x, i) => [x, i] as [string, number]).filter(([, i]) => i > 1));
const lc = buildLetterCorpus(q, c => id.has(c));
const firstOf = (s: number, a: number) => lc.wordFirst[q.indexOf(s, a, 0)];
t('corpus de lettres : tout le Coran + 112 basmalas', lc.units.length > 300000 && lc.basmala.reduce((a, b) => a + b, 0) === 112 * 19, `${lc.units.length} lettres`);
t('rasm : 1:2 → الحمدلله…', lc.units.slice(firstOf(1, 2), firstOf(1, 2) + 8).map(u => u.t).join('') === 'الحمدلله', lc.units.slice(firstOf(1, 2), firstOf(1, 2) + 8).map(u => u.t).join(''));

// ── Faux modèle ──────────────────────────────────────────────────────────────
interface Spoken { at: number; id: number }
function script(units: number[], start: number, lps: number, rnd: () => number): Spoken[] {
  return units.map((u, k) => ({ at: start + k / lps, id: id.get(lc.units[u].t) ?? 2 })).filter(() => rnd() > 0); }
function fakeWorker(get: () => Spoken[], err: { sub: number; del: number; weak: number }, rnd: () => number) {
  const w: any = { onmessage: null, terminate() {} };
  w.postMessage = (d: any) => queueMicrotask(() => {
    if (d.init) { w.onmessage({ data: { ready: 1, tokens: TOK, url: 'FAUX', tokUrl: 'FAUX', threads: 1, warmMs: 0 } }); return; }
    if (!d.run) return;
    const n = Math.floor((d.T - 7) / 4), V = 31, lp = new Float32Array(n * V), dt = (d.t1 - d.t0) / n, sp = get();
    for (let k = 0; k < n; k++) {
      const tk = d.t0 + (k + 0.5) * dt, hit = sp.find(s => s.at >= tk - dt / 2 && s.at < tk + dt / 2);
      const p = new Float32Array(V).fill(0.1 / (V - 1));
      if (hit && rnd() > err.del) { const c = rnd() < err.sub ? 2 + Math.floor(rnd() * 29) : hit.id, pk = rnd() < err.weak ? 0.45 : 0.85; p.fill((1 - pk) / (V - 1)); p[c] = pk; }
      else { p.fill(0.08 / (V - 1)); p[0] = 0.92; }
      for (let i = 0; i < V; i++) lp[k * V + i] = Math.log(p[i]);
    }
    w.onmessage({ data: { lp, n, V, t0: d.t0, t1: d.t1, ms: 60 } });
  });
  return w;
}
function mulberry(a: number) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let x = Math.imul(a ^ a >>> 15, 1 | a); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; }; }

async function scenario(name: string, segs: { s: number; a: number; aEnd?: number; basmala?: boolean }[], err = { sub: 0.08, del: 0.05, weak: 0.1 }, lps = 9, seed = 7, goto?: [number, number]) {
  const rnd = mulberry(seed); let sp: Spoken[] = []; let tcur = 0.5; const wordAt: { idx: number; at: number }[] = [];
  for (const g of segs) {
    const v0 = q.indexOf(g.s, g.a, 0), vEnd = q.indexOf(g.s, g.aEnd ?? g.a, 0), last = q.verseEnd(vEnd);
    let u0 = lc.wordFirst[v0]; if (g.basmala) while (u0 > 0 && lc.basmala[u0 - 1]) u0--;
    const u1 = lc.wordFirst[last] + rasmLen(last);
    const units = Array.from({ length: u1 - u0 }, (_, k) => u0 + k);
    sp = sp.concat(script(units, tcur, lps, rnd));
    units.forEach((u, k) => { if (!lc.basmala[u] && lc.wordFirst[lc.unitWord[u]] === u) wordAt.push({ idx: lc.unitWord[u], at: tcur + k / lps }); });
    tcur += units.length / lps + 0.8;
  }
  const s = new Session({ quran: q }); const e = new QuranCtcEngine({ spawn: () => fakeWorker(() => sp, err, rnd), models: [], tokens: [] });
  s.attachEngine(e, 'ctc'); await e.load(); if (goto) s.goto(goto[0], goto[1]);
  const reached = new Map<number, number>(); let clock = 0;
  const noise = new Float32Array(1600).map(() => (rnd() - 0.5) * 0.1);
  for (; clock < tcur + 1; clock += 0.1) {
    e.pushAudio(noise, clock); await new Promise(r => setTimeout(r, 0));
    const p = s.view().position; if (p && !reached.has(p.index)) reached.set(p.index, clock + 0.1);
  }
  await e.flush();
  // retard : pour chaque mot récité, premier instant où la position confirmée est à ce mot ou au-delà (même passage)
  const lags: number[] = []; let found = 0;
  for (const w of wordAt) { let best = Infinity; for (const [i, at] of reached) if (i >= w.idx && i <= w.idx + 6 && at >= w.at) best = Math.min(best, at - w.at); if (best < Infinity) { found++; lags.push(best); } }
  lags.sort((a, b) => a - b); const med = lags.length ? lags[lags.length >> 1] : NaN, p90 = lags.length ? lags[Math.floor(lags.length * 0.9)] : NaN;
  const fin = s.view().position, lastSeg = segs[segs.length - 1];
  const okEnd = !!fin && fin.surah === lastSeg.s && fin.ayah === (lastSeg.aEnd ?? lastSeg.a);
  return { name, cover: found / wordAt.length, med, p90, okEnd, fin: fin ? `${fin.surah}:${fin.ayah}:${fin.word}` : '—', firstLock: [...reached.values()][0] - wordAt[0].at };
}
function rasmLen(w: number) { let n = 0; for (let u = lc.wordFirst[w]; u < lc.units.length && lc.unitWord[u] === w && !lc.basmala[u]; u++) n++; return n; }

console.log('\n[Suivi complet — modèle SIMULÉ, ~9 lettres/s, 8 % substitutions, 5 % oublis, 10 % pics faibles]');
const R = [
  await scenario('Al-Mulk 67:1–5 depuis le début (basmala comprise), départ à froid', [{ s: 67, a: 1, aEnd: 5, basmala: true }]),
  await scenario('Départ à froid au milieu : Al-Baqara 2:255', [{ s: 2, a: 255 }]),
  await scenario('Saut : 36:1–3 puis 112:1–4', [{ s: 36, a: 1, aEnd: 3 }, { s: 112, a: 1, aEnd: 4, basmala: true }]),
  await scenario('Modèle très bruité (15 % subst., 10 % oublis, 30 % pics faibles) : 18:1–3', [{ s: 18, a: 1, aEnd: 3 }], { sub: 0.15, del: 0.1, weak: 0.3 }),
  await scenario('Récitation rapide (14 lettres/s) : 55:1–13', [{ s: 55, a: 1, aEnd: 13 }], undefined, 14),
  await scenario('Refrain répété 31 fois : Ar-Rahman 55:13–25', [{ s: 55, a: 13, aEnd: 25 }], undefined, 9, 11, [55, 13]),
  await scenario('Verset sauté : 67:1–2 puis 67:4–5', [{ s: 67, a: 1, aEnd: 2 }, { s: 67, a: 4, aEnd: 5 }], undefined, 9, 5, [67, 1]),
  await scenario('Verset répété : 112:1–3 puis 112:2–4', [{ s: 112, a: 1, aEnd: 3 }, { s: 112, a: 2, aEnd: 4 }], undefined, 9, 3, [112, 1]),
  await scenario('Hifz, départ connu (goto 78:1)', [{ s: 78, a: 1, aEnd: 5 }], undefined, 9, 7, [78, 1]),
];
for (const r of R) t(r.name, r.cover >= 0.85 && r.okEnd && r.med <= 0.8,
  `mots suivis ${(r.cover * 100).toFixed(0)} %, retard médian ${r.med.toFixed(2)} s, 90 % ≤ ${r.p90.toFixed(2)} s, 1re position après ${r.firstLock.toFixed(1)} s, fin ${r.fin}`);

console.log(`\n${pass} réussis, ${fail} échoués  (modèle SIMULÉ : aucune mesure réelle de précision)`);
if (fail) process.exit(1);
