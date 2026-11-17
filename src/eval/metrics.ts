import { norm } from '../quran/normalize.ts';

export interface EditCounts { sub: number; del: number; ins: number; ref: number; rate: number }
/** Distance d'édition sur des séquences quelconques (mots, caractères, phonèmes) avec décompte S/D/I. */
export function edit<T>(ref: T[], hyp: T[]): EditCounts {
  const n = ref.length, m = hyp.length;
  const d: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) d[i][0] = i; for (let j = 0; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
  let i = n, j = m, sub = 0, del = 0, ins = 0;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1)) { if (ref[i - 1] !== hyp[j - 1]) sub++; i--; j--; }
    else if (i > 0 && d[i][j] === d[i - 1][j] + 1) { del++; i--; }
    else { ins++; j--; }
  }
  return { sub, del, ins, ref: n, rate: n ? (sub + del + ins) / n : (m ? 1 : 0) };
}
const words = (s: string) => norm(s).split(' ').filter(Boolean);
export const wer = (ref: string, hyp: string) => edit(words(ref), words(hyp));
export const cer = (ref: string, hyp: string) => edit([...words(ref).join(' ')], [...words(hyp).join(' ')]);
export const per = (ref: string[], hyp: string[]) => edit(ref, hyp);

/** Agrège plusieurs enregistrements en pondérant par la taille de la référence (corpus-level), pas par moyenne de moyennes. */
export function pool(xs: EditCounts[]): EditCounts {
  const a = xs.reduce((s, x) => ({ sub: s.sub + x.sub, del: s.del + x.del, ins: s.ins + x.ins, ref: s.ref + x.ref, rate: 0 }), { sub: 0, del: 0, ins: 0, ref: 0, rate: 0 });
  a.rate = a.ref ? (a.sub + a.del + a.ins) / a.ref : 0; return a;
}
export function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}
