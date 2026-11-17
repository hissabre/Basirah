import { readFileSync } from 'node:fs';
import { QuranDB } from '../src/quran/db.ts';
import { PhonemeDB, standInLexicon } from '../src/quran/phoneme-db.ts';
import { Aligner } from '../src/align/aligner.ts';
import { rng } from './sim.ts';

const q = new QuranDB(JSON.parse(readFileSync(new URL('../data/quran-hafs-uthmani.json', import.meta.url), 'utf8')));
const db = new PhonemeDB(standInLexicon(q));
let pass = 0, fail = 0;
const t = (n: string, ok: boolean, i = '') => { ok ? pass++ : fail++; console.log((ok ? '  ✓ ' : '  ✗ ') + n + (i ? '  — ' + i : '')); };
console.log('\n[Corpus phonémique de substitution]');
t('unités indexées', db.words.length > 300000, db.words.length + ' unités (stand-in, pas le jeu du modèle)');

function noisy(units: string[], p: number, r: () => number): { tok: string[]; truth: number[] } {
  const pool = [...new Set(units)], tok: string[] = [], truth: number[] = [];
  units.forEach((u, i) => {
    const x = r();
    if (x >= p) { tok.push(u); truth.push(i); return; }
    if (x < p * 0.4) { tok.push(pool[Math.floor(r() * pool.length)]); truth.push(i); }       // substitution
    else if (x < p * 0.7) { /* suppression */ }
    else { tok.push(u); truth.push(i); tok.push(pool[Math.floor(r() * pool.length)]); truth.push(i); } // insertion
  });
  return { tok, truth };
}
const spanOf = (s: number, a: number, a2: number) => {
  const k1 = db.verses.findIndex(v => v.s === s && v.a === a), k2 = db.verses.findIndex(v => v.s === s && v.a === a2);
  return { from: db.verses[k1].start, to: db.verses[k2].start + db.verses[k2].words.length - 1 };
};
const passages: [number, number, number][] = [[1, 2, 7], [112, 1, 4], [67, 1, 12], [36, 1, 20], [55, 13, 30], [2, 255, 255]];
console.log('\n[Alignement phonémique — erreurs simulées au niveau unité (PER)]');
for (const per of [0.10, 0.15, 0.25]) {
  let wordOK = 0, ayahOK = 0, tot = 0, fj = 0, runs = 0, finOK = 0, lockN = 0, lockSum = 0;
  for (const [s, a, a2] of passages) for (let seed = 1; seed <= 12; seed++) {
    const r = rng(seed * 104729 + s), sp = spanOf(s, a, a2), units = db.words.slice(sp.from, sp.to + 1).map(w => w.t);
    const { tok, truth } = noisy(units, per, r), al = new Aligner(db, 'phoneme');
    let prev = -1, lock: number | null = null; runs++;
    for (let i = 0; i < tok.length; i += 3) {
      const st = al.push(tok.slice(i, i + 3)), tr = sp.from + truth[Math.min(i + 2, tok.length - 1)];
      tot++;
      if (st.position) {
        const p = db.wordOf(st.position.index), g = db.wordOf(tr);
        if (p.surah === g.surah && p.ayah === g.ayah) { ayahOK++; if (p.word === g.word || Math.abs(st.position.index - tr) <= 6) wordOK++; if (lock === null) lock = i + 3; }
        else if (prev >= 0 && Math.abs(st.position.index - prev) > 40) fj++;
        prev = st.position.index;
      }
    }
    if (lock !== null) { lockN++; lockSum += lock; }
    const fin = al.push([]).position; if (fin && Math.abs(fin.index - sp.to) <= 12) finOK++;
  }
  const pc = (x: number, y: number) => (100 * x / y).toFixed(1) + ' %';
  console.log(`  PER ${Math.round(per * 100)} % : verset correct ${pc(ayahOK, tot)} · mot (±) correct ${pc(wordOK, tot)} · sauts erronés ${fj}/${runs} · verrouillage ${(lockSum / Math.max(1, lockN)).toFixed(0)} unités · fin atteinte ${pc(finOK, runs)}`);
  if (per === 0.15) { t('PER 15 % : ≥ 90 % de versets corrects', ayahOK / tot >= 0.9); t('PER 15 % : 0 saut erroné', fj === 0, String(fj)); }
  if (per === 0.25) t('PER 25 % : ≥ 80 % de versets corrects', ayahOK / tot >= 0.8);
}
console.log(`\n${pass} réussis, ${fail} échoués`); process.exit(fail ? 1 : 0);
