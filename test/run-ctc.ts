/**
 * Test du suivi CTC contraint par le texte — SORTIES DE MODÈLE SIMULÉES (aucun vrai modèle acoustique n'est exécuté ici).
 * Le simulateur produit, image par image (40 ms), des probabilités « CTC pointues » avec substitutions, suppressions,
 * insertions et confusions. Les chiffres mesurent l'ALGORITHME de suivi ; ils ne disent rien de la précision d'un vrai modèle.
 */
import { readFileSync } from 'node:fs';
import { QuranDB } from '../src/quran/db.ts';
import { PhonemeDB, standInLexicon } from '../src/quran/phoneme-db.ts';
import { buildTokenCorpus, CtcTracker, type TokenCorpus } from '../src/decoder/ctc-tracker.ts';
import { rng } from './sim.ts';

const q = new QuranDB(JSON.parse(readFileSync(new URL('../data/quran-hafs-uthmani.json', import.meta.url), 'utf8')));
const db = new PhonemeDB(standInLexicon(q));
let pass = 0, fail = 0;
const t = (n: string, ok: boolean, i = '') => { ok ? pass++ : fail++; console.log((ok ? '  ✓ ' : '  ✗ ') + n + (i ? '  — ' + i : '')); };
const FRAME_MS = 40;
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : NaN; };

function makeVocab(tok: (u: string) => string) {
  const vocab = new Map<string, number>();
  for (const w of db.words) { const k = tok(w.t); if (!vocab.has(k)) vocab.set(k, vocab.size); }
  const blank = vocab.size; return { vocab, blank, size: vocab.size + 1 };
}
const full = makeVocab(u => u);
const corpusFull = buildTokenCorpus(db.words, full.vocab, full.blank, full.size, 4);
console.log('\n[Corpus] ' + db.words.length + ' unités, vocabulaire ' + (full.size - 1) + ' + blanc (unités de SUBSTITUTION : ni celles de TajweedFormer ni d\'un modèle réel)');

interface Sim { frames: Float32Array[]; spike: number[]; truth: number[] }
/** Simule un récitant : unités consécutives de `from` à `to`, ~10 unités/s, + retard de modèle (chunk/look-ahead) de `delayFrames`. */
function simulate(c: TokenCorpus, size: number, from: number, to: number, o: { sub: number; del: number; ins: number; weak: number; delayFrames: number; lead?: number }, r: () => number): Sim {
  const spike: number[] = [], truth: number[] = [], ev: { f: number; tok: number }[] = [];
  let f = (o.lead ?? 6);
  for (let i = from; i <= to; i++) {
    f += 2 + Math.floor(r() * 2);
    spike.push(f + o.delayFrames); truth.push(i);
    const x = r();
    if (x < o.del) continue;
    let tok = c.ids[i];
    if (x < o.del + o.sub) tok = Math.floor(r() * (size - 1));
    ev.push({ f: f + o.delayFrames, tok });
    if (r() < o.ins) ev.push({ f: f + o.delayFrames + 1, tok: Math.floor(r() * (size - 1)) });
  }
  const n = f + o.delayFrames + 8, frames: Float32Array[] = [];
  const byF = new Map<number, number[]>(); for (const e of ev) { const l = byF.get(e.f); if (l) l.push(e.tok); else byF.set(e.f, [e.tok]); }
  for (let k = 0; k < n; k++) {
    const p = new Float32Array(size).fill(1e-5), blank = size - 1, toks = byF.get(k);
    if (toks && toks[0] >= 0) {
      const peak = o.weak ? 0.25 + r() * 0.55 : 0.5 + r() * 0.45;
      p[toks[0]] += peak; p[Math.floor(r() * (size - 1))] += r() * 0.15; p[blank] += 1 - peak;
    } else { p[blank] += 0.92 + r() * 0.07; if (r() < 0.2) p[Math.floor(r() * (size - 1))] += r() * 0.05; }
    let s = 0; for (let v = 0; v < size; v++) s += p[v];
    for (let v = 0; v < size; v++) p[v] = Math.log(p[v] / s);
    frames.push(p);
  }
  return { frames, spike, truth };
}
const expectedIdx = (sim: Sim, frame: number) => { let k = -1; for (let i = 0; i < sim.spike.length; i++) if (sim.spike[i] <= frame) k = sim.truth[i]; return k; };

const passages: [number, number, number][] = [[1, 2, 7], [112, 1, 4], [67, 1, 12], [36, 1, 20], [55, 13, 30], [78, 1, 20]];
const spanOf = (s: number, a: number, a2: number) => {
  const k1 = db.verses.findIndex(v => v.s === s && v.a === a), k2 = db.verses.findIndex(v => v.s === s && v.a === a2);
  return { from: db.verses[k1].start, to: db.verses[k2].start + db.verses[k2].words.length - 1 };
};

function runHinted(c: TokenCorpus, size: number, o: Parameters<typeof simulate>[4], label: string, seeds = 8, topts: ConstructorParameters<typeof CtcTracker>[1] = {}) {
  let ok = 0, tot = 0; const lag: number[] = []; let cpu = 0, fr = 0;
  for (const [s, a, a2] of passages) for (let sd = 1; sd <= seeds; sd++) {
    const r = rng(sd * 7919 + s), sp = spanOf(s, a, a2), sim = simulate(c, size, sp.from, sp.to, o, r), tr = new CtcTracker(c, topts);
    tr.startAt(sp.from); let reach = new Map<number, number>(), mx = -1;
    for (let f = 0; f < sim.frames.length; f++) {
      const t0 = performance.now(); const out = tr.push(sim.frames[f], f * FRAME_MS / 1000); cpu += performance.now() - t0; fr++;
      if (!out) continue;
      if (out.index > mx) { for (let k = mx + 1; k <= out.index; k++) reach.set(k, f); mx = out.index; }
      const e = expectedIdx(sim, f); if (e >= 0 && f > sim.spike[0] + 4) { tot++; if (Math.abs(out.index - e) <= 2) ok++; }
    }
    sim.truth.forEach((k, i) => { const f = reach.get(k); if (f !== undefined) lag.push((f - sim.spike[i]) * FRAME_MS); });
  }
  console.log(`  ${label}: position à ±2 unités ${(100 * ok / tot).toFixed(1)} % des images · avance du suivi sur le modèle : médiane ${med(lag)} ms, p90 ${pct(lag, 0.9)} ms · coût ${(cpu / fr).toFixed(3)} ms/image`);
  return { acc: ok / tot, lagMed: med(lag), lagP90: pct(lag, 0.9), cpuPerFrame: cpu / fr };
}

console.log('\n[Départ connu (mode Hifz / sourate choisie) — modèle simulé]');
const good = runHinted(corpusFull, full.size, { sub: 0.08, del: 0.04, ins: 0.04, weak: 0, delayFrames: 4 }, 'modèle propre (≈ 12 % d\'erreurs d\'unité)');
const noisy = runHinted(corpusFull, full.size, { sub: 0.15, del: 0.08, ins: 0.08, weak: 0, delayFrames: 4 }, 'modèle bruité (≈ 30 % d\'erreurs, pics nets)');
const weakInfo = runHinted(corpusFull, full.size, { sub: 0.03, del: 0.01, ins: 0.01, weak: 1, delayFrames: 4 }, 'LIMITE CONNUE — peu d\'erreurs mais pics faibles (0.25–0.8)');
t('suivi à ±2 unités ≥ 95 % (modèle propre)', good.acc >= 0.95, (100 * good.acc).toFixed(1) + ' %');
t('suivi à ±2 unités ≥ 80 % (modèle bruité, pics nets)', noisy.acc >= 0.8, (100 * noisy.acc).toFixed(1) + ' %');
console.log('  (information, sans seuil) pics faibles : ' + (100 * weakInfo.acc).toFixed(1) + ' % — le suivi décroche quand le modèle est peu sûr de lui ; à recalibrer sur un vrai modèle (advFloor, température)');
t('retard ajouté par le décodeur ≤ 1 image (médiane)', good.lagMed <= FRAME_MS, good.lagMed + ' ms (le retard du modèle lui-même s\'y AJOUTE)');
t('coût CPU du décodeur < 1 ms par image', good.cpuPerFrame < 1, good.cpuPerFrame.toFixed(3) + ' ms (Node, machine de test ; pas un téléphone)');

console.log('\n[Départ à froid : aucune indication, le récitant commence quelque part]');
function runCold(o: Parameters<typeof simulate>[4], label: string) {
  const lockUnits: number[] = [], lockMs: number[] = [], posMs: number[] = []; let never = 0, wrong = 0, runs = 0;
  for (const [s, a, a2] of passages) for (let sd = 1; sd <= 10; sd++) {
    const r = rng(sd * 104729 + s), sp = spanOf(s, a, a2), sim = simulate(corpusFull, full.size, sp.from, sp.to, o, r), tr = new CtcTracker(corpusFull);
    runs++; let lockAt = -1, good = 0, posGood = 0, posAt = -1;
    for (let f = 0; f < sim.frames.length; f++) {
      const out = tr.push(sim.frames[f], f * FRAME_MS / 1000); if (!out) { good = 0; posGood = 0; continue; }
      const e = expectedIdx(sim, f), okPos = e >= 0 && Math.abs(out.index - e) <= 3;
      if (okPos) { posGood++; if (posGood >= 6 && posAt < 0) posAt = f - 5; } else posGood = 0;
      if (out.locked && okPos) { good++; if (good >= 6 && lockAt < 0) lockAt = f - 5; } else if (out.locked && !okPos && lockAt < 0) { wrong++; good = 0; } else good = 0;
    }
    if (posAt >= 0) posMs.push((posAt - sim.spike[0]) * FRAME_MS);
    if (lockAt < 0) never++; else { lockMs.push((lockAt - sim.spike[0]) * FRAME_MS); lockUnits.push(sim.spike.filter(x => x <= lockAt).length); }
  }
  console.log(`  ${label}: verrouillage correct dans ${runs - never}/${runs} essais · médiane ${med(lockMs)} ms (${med(lockUnits)} unités), p90 ${pct(lockMs, 0.9)} ms · faux verrouillages ${wrong}\n    position correcte (même sans l'indicateur « verrouillé ») après : médiane ${med(posMs)} ms, p90 ${pct(posMs, 0.9)} ms`);
  return { never, runs, wrong, med: med(lockMs), p90: pct(lockMs, 0.9), posMed: med(posMs) };
}
const cg = runCold({ sub: 0.08, del: 0.04, ins: 0.04, weak: 0, delayFrames: 4 }, 'modèle propre');
const cn = runCold({ sub: 0.15, del: 0.08, ins: 0.08, weak: 0, delayFrames: 4 }, 'modèle bruité (pics nets)');
t('départ à froid : position correcte en < 1,5 s (médiane, modèle propre)', cg.posMed < 1500, cg.posMed + ' ms');
t('verrouillage à froid ≥ 90 % des essais (modèle propre)', (cg.runs - cg.never) / cg.runs >= 0.9, `${cg.runs - cg.never}/${cg.runs}`);
t('faux verrouillages ≤ 5 % des essais (modèle propre)', cg.wrong <= 0.05 * cg.runs, cg.wrong + '/' + cg.runs);
console.log('  (information) modèle bruité : ' + (cn.runs - cn.never) + '/' + cn.runs + ' verrouillés, ' + cn.wrong + ' faux verrouillages');

console.log('\n[Saut : le récitant change de verset en cours de route]');
{
  const A = spanOf(1, 2, 7), B = spanOf(67, 1, 12); const relocMs: number[] = []; let fails = 0, runs = 0;
  for (let sd = 1; sd <= 20; sd++) {
    const r = rng(sd * 31337), o = { sub: 0.08, del: 0.04, ins: 0.04, weak: 0, delayFrames: 4 };
    const a = simulate(corpusFull, full.size, A.from, A.from + 15, o, r), b = simulate(corpusFull, full.size, B.from, B.from + 30, o, r, ), tr = new CtcTracker(corpusFull);
    tr.startAt(A.from); const off = a.frames.length; let loc = -1, good = 0; runs++;
    for (let f = 0; f < a.frames.length + b.frames.length; f++) {
      const out = tr.push(f < off ? a.frames[f] : b.frames[f - off], 0); if (f < off || !out) continue;
      const e = expectedIdx(b, f - off); if (e >= 0 && Math.abs(out.index - e) <= 3) { good++; if (good >= 6 && loc < 0) loc = f - 5; } else good = 0;
    }
    if (loc < 0) fails++; else relocMs.push((loc - off - b.spike[0]) * FRAME_MS);
  }
  console.log(`  reprise correcte ${runs - fails}/${runs} · médiane ${med(relocMs)} ms, p90 ${pct(relocMs, 0.9)} ms après le début du nouveau passage`);
  t('reprise après saut ≥ 90 %', (runs - fails) / runs >= 0.9, `${runs - fails}/${runs}`);
}

console.log('\n[Modèle-agnostique : un AUTRE jeu d\'unités (lettres seules, sans voyelles)]');
{
  const L = makeVocab(u => u[0]); const cL = buildTokenCorpus(db.words.map(w => ({ t: w.t[0] })), L.vocab, L.blank, L.size, 6);
  const rr = runHinted(cL, L.size, { sub: 0.08, del: 0.04, ins: 0.04, weak: 0, delayFrames: 4 }, `lettres seules (${L.size - 1} unités)`, 5);
  t('fonctionne avec un autre vocabulaire (≥ 90 %)', rr.acc >= 0.9, (100 * rr.acc).toFixed(1) + ' %');
}
console.log(`\n${pass} réussis, ${fail} échoués  (SIMULATION : aucune mesure sur un vrai modèle)`);
process.exit(fail ? 1 : 0);
