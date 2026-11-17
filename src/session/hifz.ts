import type { QuranDB } from '../quran/db.ts';
import type { TraceEntry } from '../align/aligner.ts';

export type WordStatus = 'ok' | 'uncertain' | 'missed' | 'wrong';
export interface VerseResult { surah: number; ayah: number; ok: number; missed: number; wrong: number; uncertain: number; total: number; at: number }

/**
 * Suivi Hifz à partir de la trace de l'aligneur. IMPORTANT : un mot « manqué » peut être un mot omis par le récitant OU un mot que le
 * moteur n'a pas entendu — le texte seul ne permet pas de les distinguer. L'interface doit donc afficher « mot peut-être omis ».
 * Un mot « remplacé » n'est signalé que si la similarité est très faible (< 0,45) ; entre 0,45 et le seuil de correspondance : « incertain ».
 */
export class HifzTracker {
  readonly status = new Map<number, WordStatus>();
  repeats = 0; duplicates = 0;
  readonly verses: VerseResult[] = [];
  private lastProgress: number | null = null; private stuckFired = false;
  constructor(private readonly db: QuranDB, private readonly matchMin = 0.62, private readonly wrongBelow = 0.45) {}

  consume(trace: TraceEntry[], nowSec: number): void {
    const db = this.db;
    for (const t of trace) {
      const v = db.verseOf(t.e);
      if (t.kind === 'ins') continue;
      if (t.kind === 'dup') { this.duplicates++; continue; }
      if (t.kind === 'repeat') { this.repeats++; for (let i = v.start; i < v.start + v.words.length; i++) this.status.delete(i); }
      if (t.kind === 'skip') for (let k = t.e - t.skipped; k < t.e; k++) if (!this.status.has(k) && db.verseOf(k) === v) this.status.set(k, 'missed');
      this.status.set(t.e, t.sim >= this.matchMin ? 'ok' : t.sim < this.wrongBelow ? 'wrong' : 'uncertain');
      this.lastProgress = nowSec; this.stuckFired = false;
      if (t.e === v.start + v.words.length - 1) this.finishVerse(v, nowSec);
    }
  }
  private finishVerse(v: { s: number; a: number; start: number; words: string[] }, at: number) {
    const r: VerseResult = { surah: v.s, ayah: v.a, ok: 0, missed: 0, wrong: 0, uncertain: 0, total: v.words.length, at };
    for (let i = v.start; i < v.start + v.words.length; i++) { const s = this.status.get(i); if (s) r[s]++; }
    this.verses.push(r);
  }
  /** Bloqué = aucun mot nouveau depuis `thresholdSec` ; ne se déclenche qu'une fois par blocage. */
  checkStuck(nowSec: number, index: number | null, thresholdSec = 6, n = 3): { stuck: boolean; hint: string[] } {
    if (index === null || this.lastProgress === null || this.stuckFired || nowSec - this.lastProgress < thresholdSec) return { stuck: false, hint: [] };
    this.stuckFired = true; return { stuck: true, hint: this.next(index, n) };
  }
  /** Suite correcte à la demande (texte original, avec voyelles). */
  next(index: number, n = 3): string[] {
    const db = this.db, v = db.verseOf(index), j = db.words[index].j, out = v.words.slice(j + 1, j + 1 + n);
    return out;
  }
  summary() { let ok = 0, missed = 0, wrong = 0, uncertain = 0; for (const s of this.status.values()) { if (s === 'ok') ok++; else if (s === 'missed') missed++; else if (s === 'wrong') wrong++; else uncertain++; }
    return { words: this.status.size, ok, missed, wrong, uncertain, repeats: this.repeats, versesCompleted: this.verses.length }; }
}
