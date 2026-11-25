import type { QuranDB } from './db.ts';

/**
 * Texte du Coran → suite de LETTRES (rasm), telle que l'écrit un modèle « lettres seules » :
 * voyelles, signes coraniques, alif suscrit et petites lettres retirés ; ٱأإآ→ا ; ؤ→و ; ئ→ي ; ة→ه ; ى→ي (repli seulement si
 * la lettre d'origine n'existe pas dans le vocabulaire du modèle). Le texte affiché n'est jamais modifié.
 */
const MARKS = /[ؐ-ًؚ-ٰٟۖ-ۭـ࣓-ࣿ]/g;
const FALLBACK: Record<string, string[]> = { 'ٱ': ['ا'], 'أ': ['ا'], 'إ': ['ا'], 'آ': ['ا'], 'ؤ': ['و', 'ء'], 'ئ': ['ي', 'ى', 'ء'], 'ة': ['ه', 'ت'], 'ى': ['ي', 'ا'], 'ء': [] };

export function rasmLetters(word: string, has: (ch: string) => boolean): string[] {
  const out: string[] = [];
  for (const ch of word.replace(MARKS, '')) {
    if (!/[ء-يٱ]/.test(ch)) continue;
    if (has(ch)) { out.push(ch); continue; }
    const f = (FALLBACK[ch] ?? []).find(has); if (f) out.push(f);
  }
  return out;
}

export interface LetterCorpus {
  /** Une lettre par unité. */
  units: { t: string }[];
  /** Mot (index QuranDB) de chaque unité. */
  unitWord: Int32Array;
  /** 1 = l'unité appartient à une basmala d'ouverture de sourate (jamais une position confirmée : elle existe 113 fois). */
  basmala: Uint8Array;
  /** Première unité de chaque mot QuranDB. */
  wordFirst: Int32Array;
}

/** Construit le corpus de lettres de tout le Coran (basmala d'ouverture comprise, avant chaque sourate sauf 1 et 9). */
export function buildLetterCorpus(q: QuranDB, has: (ch: string) => boolean): LetterCorpus {
  const units: { t: string }[] = [], uw: number[] = [], bs: number[] = [], wf = new Int32Array(q.words.length).fill(-1);
  for (const v of q.verses) {
    if (v.bismillah) for (const w of v.bismillah.split(' ')) for (const ch of rasmLetters(w, has)) { units.push({ t: ch }); uw.push(v.start); bs.push(1); }
    v.words.forEach((w, j) => {
      const L = rasmLetters(w, has); wf[v.start + j] = units.length;
      if (!L.length) { units.push({ t: '\u0000' }); uw.push(v.start + j); bs.push(0); return; } // mot sans lettre connue : joker
      for (const ch of L) { units.push({ t: ch }); uw.push(v.start + j); bs.push(0); }
    });
  }
  return { units, unitWord: Int32Array.from(uw), basmala: Uint8Array.from(bs), wordFirst: wf };
}
