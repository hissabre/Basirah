import type { CorpusDB } from './db.ts';
import { QuranDB } from './db.ts';
import type { Position } from '../types.ts';

/**
 * Corpus au niveau PHONÉMIQUE : chaque « mot » du corpus de l'Aligner est une unité phonétique.
 * La table réelle (phonétisation canonique Hafs) viendra du modèle Quran-Lab ; ce module ne dépend que de la forme ci-dessous.
 */
export interface PhonemeLexicon {
  /** Un élément par verset, dans l'ordre 1:1 … 114:6, chaque mot = liste d'unités phonétiques. */
  verses: { s: number; a: number; words: string[][] }[];
}

export class PhonemeDB implements CorpusDB {
  readonly verses: { s: number; a: number; start: number; words: string[]; wordStarts: number[] }[] = [];
  readonly words: { t: string; v: number; j: number }[] = [];
  readonly surahStarts: number[] = [];
  readonly surahEnds = new Set<number>();
  readonly gramMain = 5; readonly gramSmall = 3;
  readonly idxMain = new Map<string, number[]>(); readonly idxSmall = new Map<string, number[]>();
  readonly basmalaEnd: number;
  constructor(lex: PhonemeLexicon) {
    for (const v of lex.verses) {
      const k = this.verses.length, start = this.words.length, units: string[] = [], wordStarts: number[] = [];
      for (const w of v.words) { wordStarts.push(units.length); units.push(...w); }
      this.verses.push({ s: v.s, a: v.a, start, words: units, wordStarts });
      units.forEach((u, j) => this.words.push({ t: u, v: k, j }));
      if (v.a === 1) this.surahStarts.push(start);
    }
    const add = (m: Map<string, number[]>, key: string, i: number) => { const l = m.get(key); if (l) l.push(i); else m.set(key, [i]); };
    for (let i = 0; i < this.words.length; i++) {
      const nx = this.words[i + 1];
      if (!nx || this.verses[nx.v].s !== this.verses[this.words[i].v].s) this.surahEnds.add(i);
      if (i >= this.gramMain - 1) add(this.idxMain, this.words.slice(i - this.gramMain + 1, i + 1).map(w => w.t).join(' '), i);
      if (i >= this.gramSmall - 1) add(this.idxSmall, this.words.slice(i - this.gramSmall + 1, i + 1).map(w => w.t).join(' '), i);
    }
    this.basmalaEnd = this.verses[0].start + this.verses[0].words.length - 1;
  }
  keyOf(t: string) { return t; }
  simOf(a: string, b: string) { return a === b ? 1 : 0; }
  position(i: number): Position { const w = this.words[i], v = this.verses[w.v]; return { surah: v.s, ayah: v.a, word: w.j, index: i }; }
  verseStart(i: number) { return this.verses[this.words[i].v].start; }
  isBoundary(i: number) { return this.surahEnds.has(i) || i === this.basmalaEnd; }
  /** (sourate, verset, mot) → index d'unité. */
  unitIndexOf(s: number, a: number, word = 0): number { const k = this.verses.findIndex(v => v.s === s && v.a === a); if (k < 0) return -1; const v = this.verses[k]; return v.start + (v.wordStarts[Math.min(word, v.wordStarts.length - 1)] ?? 0); }
  /** Unité → (verset, mot) : donne la synchronisation mot à mot à partir d'une position phonémique. */
  wordOf(i: number): { surah: number; ayah: number; word: number } {
    const w = this.words[i], v = this.verses[w.v]; let k = 0;
    while (k + 1 < v.wordStarts.length && v.wordStarts[k + 1] <= w.j) k++;
    return { surah: v.s, ayah: v.a, word: k };
  }
}

/**
 * PHONÉTISEUR DE SUBSTITUTION — uniquement pour tester l'algorithme tant que la vraie table Quran-Lab n'est pas disponible.
 * Une unité = lettre de base + ses voyelles/diacritiques (ressemble à « consonne + ḥaraka »), mais N'EST PAS le jeu d'unités du modèle.
 */
export function standInLexicon(q: QuranDB): PhonemeLexicon {
  const re = /[ء-يٱ][ً-ْٰ]*/gu;
  return {
    verses: q.verses.map(v => ({
      s: v.s, a: v.a,
      words: v.words.map(w => { const u = (w.match(re) || []).map(x => x.normalize('NFC')); return u.length ? u : [w]; }),
    })),
  };
}

/** Vérifie que le lexique phonémique a la même segmentation en mots que la base de texte (nécessaire pour convertir les positions). */
export function lexiconCompat(q: QuranDB, p: PhonemeDB): { mismatchedVerses: number; total: number } {
  let bad = 0;
  q.verses.forEach((v, k) => { const pv = p.verses[k]; if (!pv || pv.s !== v.s || pv.a !== v.a || pv.wordStarts.length !== v.words.length) bad++; });
  return { mismatchedVerses: bad, total: q.verses.length };
}
