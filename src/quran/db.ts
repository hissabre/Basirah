import { norm, skeleton, sim } from './normalize.ts';
import type { Position } from '../types.ts';

export interface RawQuran { riwaya: string; source: string; verses: [number, number, string][] }
export interface Verse { s: number; a: number; text: string; words: string[]; start: number; bismillah: string }
export interface Word { t: string; sk: string; v: number; j: number }

const BSM = norm('بسم الله الرحمن الرحيم');

/** Ce dont l'Aligner a besoin d'un corpus : mots (ou unités phonétiques) en séquence, versets, index de n-grammes. */
export interface CorpusDB {
  readonly verses: { s: number; a: number; start: number; words: unknown[] }[];
  readonly words: { t: string; v: number; j: number }[];
  readonly surahStarts: number[];
  readonly gramMain: number; readonly gramSmall: number;
  readonly idxMain: Map<string, number[]>; readonly idxSmall: Map<string, number[]>;
  keyOf(token: string): string;
  simOf(a: string, b: string): number;
  position(i: number): Position;
  verseStart(i: number): number;
  isBoundary(i: number): boolean;
}

/** Base de données du Coran : séparée de toute logique de reconnaissance. Le texte original n'est jamais modifié. */
export class QuranDB implements CorpusDB {
  readonly gramMain = 3; readonly gramSmall = 2;
  get idxMain() { return this.tri; } get idxSmall() { return this.bi; }
  keyOf(t: string) { return skeleton(t); }
  simOf(a: string, b: string) { return sim(a, b); }
  readonly riwaya: string;
  readonly verses: Verse[] = [];
  readonly words: Word[] = [];
  /** Index du premier mot de chaque sourate (1:1 compris). */
  readonly surahStarts: number[] = [];
  readonly surahEnds = new Set<number>();
  readonly tri = new Map<string, number[]>();
  readonly bi = new Map<string, number[]>();
  readonly basmalaEnd: number;

  constructor(raw: RawQuran) {
    if (raw.verses.length !== 6236) throw new Error('Texte invalide : ' + raw.verses.length + ' versets (6236 attendus)');
    this.riwaya = raw.riwaya;
    let ps = 0, pa = 0;
    for (const [s, a, text] of raw.verses) {
      if (!((s === ps && a === pa + 1) || (s === ps + 1 && a === 1))) throw new Error('Numérotation incohérente à ' + s + ':' + a);
      ps = s; pa = a;
      let tk = text.split(' ').filter(Boolean), bismillah = '';
      if (a === 1 && s > 1 && tk.length > 4 && norm(tk.slice(0, 4).join(' ')) === BSM) { bismillah = tk.slice(0, 4).join(' '); tk = tk.slice(4); }
      const w: string[] = [];
      for (const x of tk) { if (!norm(x) && w.length) w[w.length - 1] += ' ' + x; else w.push(x); }
      const k = this.verses.length, start = this.words.length;
      this.verses.push({ s, a, text, words: w, start, bismillah });
      w.forEach((x, j) => { const t = norm(x); this.words.push({ t, sk: skeleton(t), v: k, j }); });
      if (a === 1) this.surahStarts.push(start);
    }
    for (let i = 0; i < this.words.length; i++) {
      const nxt = this.words[i + 1];
      if (!nxt || this.verses[nxt.v].s !== this.verses[this.words[i].v].s) this.surahEnds.add(i);
      if (i >= 2) this.add(this.tri, this.words[i - 2].sk + ' ' + this.words[i - 1].sk + ' ' + this.words[i].sk, i);
      if (i >= 1) this.add(this.bi, this.words[i - 1].sk + ' ' + this.words[i].sk, i);
    }
    const f1 = this.verses[0];
    this.basmalaEnd = f1.start + f1.words.length - 1;
  }
  private add(m: Map<string, number[]>, k: string, i: number) { const l = m.get(k); if (l) l.push(i); else m.set(k, [i]); }

  verseOf(i: number): Verse { return this.verses[this.words[i].v]; }
  /** Index du mot (dans ce corpus) pour sourate/verset/mot. */
  indexOf(s: number, a: number, word = 0): number { const k = this.verses.findIndex(v => v.s === s && v.a === a); return k < 0 ? -1 : this.verses[k].start + Math.min(word, this.verses[k].words.length - 1); }
  position(i: number): Position { const w = this.words[i], v = this.verses[w.v]; return { surah: v.s, ayah: v.a, word: w.j, index: i }; }
  verseStart(i: number): number { return this.verses[this.words[i].v].start; }
  verseEnd(i: number): number { const v = this.verses[this.words[i].v]; return v.start + v.words.length - 1; }
  /** Un nouvel emplacement possible après ce mot (fin de sourate ou fin de la basmala). */
  isBoundary(i: number): boolean { return this.surahEnds.has(i) || i === this.basmalaEnd; }
}
