import type { CorpusDB } from '../quran/db.ts';
import { Aligner, type ProfileName } from '../align/aligner.ts';
import { Stabilizer } from '../align/stabilizer.ts';
import type { Recording } from './manifest.ts';
import { percentile } from './metrics.ts';

/** Résultat d'un moteur tel qu'enregistré par le banc (une ligne JSONL). */
export interface HypLine { unit: 'text' | 'phoneme'; text: string; tokens?: string[]; audioStart: number; audioEnd: number; isFinal: boolean; /** secondes murales depuis le début du traitement, si mesurées */ wall?: number }

export interface TrackReport {
  scored: number;            // nb d'instants évalués (versets référencés)
  ayahAccuracy: number | null;   // part du temps où le verset affiché = verset réel (après 1er verrouillage)
  timeToFirstLockSec: number | null;
  falseJumps: number;        // changements de position confirmés vers un mauvais verset (distance > 1 verset)
  recoveries: number[];      // secondes pour retrouver le bon verset après une position fausse
  wordSyncMeanErr: number | null; // |mot affiché − mot attendu| moyen, si le corpus et les heures par mot le permettent (non calculé ici)
  lagSec: number[];          // retard de la position affichée : temps entre début réel du verset et premier affichage correct
}

/** Verset réel à l'instant t d'après les heures par verset de la référence. */
function truthAt(rec: Recording, t: number): { s: number; a: number } | null {
  for (const seg of rec.reference.segments) for (const x of seg.ayahTimes ?? []) if (t >= x.startSec && t < x.endSec) return { s: x.surah, a: x.ayah };
  return null;
}

/**
 * Rejoue les résultats d'un moteur dans le MÊME chemin (Stabilizer → Aligner) que l'application, en horloge audio,
 * et compare à la référence. Aucune bascule, aucun filtre propre à un moteur.
 */
export function replayTracking(db: CorpusDB, rec: Recording, hyps: HypLine[], profile: ProfileName, verseOf: (pos: { surah: number; ayah: number }) => { s: number; a: number } = p => ({ s: p.surah, a: p.ayah })): TrackReport {
  const al = new Aligner(db, profile), st = new Stabilizer(2);
  let ok = 0, tot = 0, firstLock: number | null = null, falseJumps = 0, wrongSince: number | null = null;
  const rec_: number[] = [], lag: number[] = []; let lastVerseKey = '';
  const seenFirstCorrect = new Set<string>();
  for (const h of hyps) {
    const words = st.push({ text: h.text, tokens: h.tokens, unit: h.unit, isFinal: h.isFinal, audioStart: h.audioStart });
    if (!words.length) continue;
    const s = al.push(words), t = h.audioEnd, tr = truthAt(rec, t);
    for (const e of s.events) if ((e.kind === 'jump') && e.to && tr) { const v = verseOf(e.to); if (v.s !== tr.s || Math.abs(v.a - tr.a) > 1) falseJumps++; }
    if (!s.position) continue;
    const pos = verseOf(s.position);
    if (firstLock === null) firstLock = t;
    if (!tr) continue;
    tot++;
    const good = pos.s === tr.s && pos.a === tr.a;
    if (good) { ok++; if (wrongSince !== null) { rec_.push(t - wrongSince); wrongSince = null; } const key = tr.s + ':' + tr.a; if (!seenFirstCorrect.has(key)) { seenFirstCorrect.add(key); const seg = rec.reference.segments.flatMap(x => x.ayahTimes ?? []).find(x => x.surah === tr.s && x.ayah === tr.a); if (seg) lag.push(Math.max(0, t - seg.startSec)); } }
    else if (wrongSince === null) wrongSince = t;
    lastVerseKey = pos.s + ':' + pos.a;
  }
  void lastVerseKey;
  return { scored: tot, ayahAccuracy: tot ? ok / tot : null, timeToFirstLockSec: firstLock, falseJumps, recoveries: rec_, wordSyncMeanErr: null, lagSec: lag };
}
export const summarize = (xs: number[]) => ({ n: xs.length, median: percentile(xs, 0.5), p90: percentile(xs, 0.9) });
