import { QuranDB } from '../src/quran/db.ts';
import { Aligner, type ProfileName } from '../src/align/aligner.ts';

export function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const LET = 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي';
const CONF: Record<string, string> = { س: 'ثص', ث: 'س', ص: 'س', ذ: 'ز', ز: 'ذ', ض: 'ظ', ظ: 'ض', ت: 'ط', ط: 'ت', ك: 'ق', ق: 'ك', ح: 'ه' };

/** Corrompt un mot comme le ferait un moteur de reconnaissance imparfait. */
export function corrupt(w: string, r: () => number, p: number): string[] {
  const x = r();
  if (x >= p) return [w];                                        // mot correctement reconnu
  if (x < p * 0.30) return [];                                   // mot omis
  if (x < p * 0.55) {                                            // confusion de lettre (fréquente)
    const i = Math.floor(r() * w.length), c = w[i], rep = CONF[c] ? CONF[c][Math.floor(r() * CONF[c].length)] : LET[Math.floor(r() * LET.length)];
    return [w.slice(0, i) + rep + w.slice(i + 1)];
  }
  if (x < p * 0.75) return [w.slice(0, -1) || w];                // lettre finale perdue
  if (x < p * 0.90) return [LET.slice(0, 2 + Math.floor(r() * 3))]; // mot parasite/halluciné
  return [w, w];                                                 // mot dupliqué
}

export interface Span { from: number; to: number } // indices de mots du corpus [from,to]
/** Mots reconnus (déjà « confirmés ») pour un passage, avec bruit. */
export function transcribe(db: QuranDB, span: Span, r: () => number, p: number): string[] {
  const out: string[] = [];
  for (let i = span.from; i <= span.to; i++) out.push(...corrupt(db.words[i].t, r, p));
  return out;
}
export const verseSpan = (db: QuranDB, s: number, a: number, a2 = a): Span => {
  const k1 = db.verses.findIndex(v => v.s === s && v.a === a), k2 = db.verses.findIndex(v => v.s === s && v.a === a2);
  return { from: db.verses[k1].start, to: db.verses[k2].start + db.verses[k2].words.length - 1 };
};

export interface RunStats { ayahOK: number; ayahTotal: number; falseJumps: number; wordsToLock: number | null; updates: number }
/** Joue des mots un par un par petits lots (comme le flux confirmé d'un moteur) et mesure le suivi. */
export function play(al: Aligner, db: QuranDB, words: string[], truthAt: (i: number) => number, batch = 2): RunStats {
  let ayahOK = 0, ayahTotal = 0, falseJumps = 0, updates = 0, lock: number | null = null, prev = -1;
  for (let i = 0; i < words.length; i += batch) {
    const st = al.push(words.slice(i, i + batch));
    const t = truthAt(Math.min(i + batch - 1, words.length - 1));
    if (st.position) {
      ayahTotal++; const same = db.words[st.position.index].v === db.words[t].v || Math.abs(st.position.index - t) <= 2;
      if (same) { ayahOK++; if (lock === null) lock = i + batch; }
      if (prev >= 0 && st.position.index !== prev) { updates++; if (!same && Math.abs(st.position.index - prev) > 6) falseJumps++; }
      prev = st.position.index;
    } else ayahTotal++;
  }
  return { ayahOK, ayahTotal, falseJumps, wordsToLock: lock, updates };
}
