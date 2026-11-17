import type { CorpusDB } from '../quran/db.ts';
import type { Position } from '../types.ts';

/**
 * Moteur d'alignement : suit la position dans le Coran à partir d'un flux de mots confirmés.
 * Indépendant du moteur de reconnaissance (en ligne, hors ligne, rejeu) et de l'interface.
 *
 * Principe : faisceau (beam) d'hypothèses « je suis au mot e ». À chaque mot reconnu, chaque hypothèse peut :
 *  avancer (+1), sauter des mots (+2/+3 = mots omis), rester (mot répété), ignorer un mot parasite, recommencer le verset
 *  (répétition), ou — aux fins de sourate / basmala — entrer dans une nouvelle sourate. De nouvelles hypothèses « lointaines »
 *  sont injectées depuis un index de trigrammes (récupération si la position est perdue), mais avec une pénalité de saut :
 *  elles ne l'emportent qu'après plusieurs mots concordants, pas sur une transcription courte et erronée.
 *  La position AFFICHÉE ne change qu'après confirmation (séquence + marge sur la 2e hypothèse).
 */
export interface AlignConfig {
  beam: number; decay: number; matchMin: number;
  mismatch: number; skip: number; dup: number; ins: number; restart: number; boundary: number; jumpNear: number; jumpFar: number;
  runNear: number; marginNear: number; runFar: number; marginFar: number; runInit: number; marginInit: number; lostAfter: number;
}
const BASE: AlignConfig = {
  beam: 28, decay: 0.9, matchMin: 0.62, mismatch: -1.0, skip: -0.8, dup: -1.0, ins: -1.2, restart: -2.5, boundary: -1.2,
  jumpNear: -1.0, jumpFar: -3.0, runNear: 2, marginNear: 0.3, runFar: 4, marginFar: 1.5, runInit: 3, marginInit: 0.8, lostAfter: 7,
};
export const PROFILES = {
  /** Prière : le texte avance presque toujours ; saut lointain très coûteux, affichage stable. */
  prayer: { ...BASE, decay: 0.92, jumpFar: -3.5, runFar: 5, marginFar: 2.0 },
  /** Hifz : l'utilisateur répète, revient en arrière, hésite : retours plus faciles. */
  hifz: { ...BASE, restart: -1.5, runFar: 4, marginFar: 1.2 },
  /** Lecture : suit un lecteur qui peut aussi naviguer. */
  reading: { ...BASE },
  /** Flux d'UNITÉS PHONÉMIQUES (≈ 5× plus de jetons que de mots, correspondance exacte) : tous les seuils sont étendus. */
  phoneme: { ...BASE, beam: 40, decay: 0.97, matchMin: 0.99, mismatch: -0.7, skip: -0.5, dup: -1.0, ins: -0.6, restart: -4, boundary: -2,
    jumpNear: -2, jumpFar: -6, runNear: 3, marginNear: 0.5, runFar: 10, marginFar: 2.0, runInit: 4, marginInit: 0.8, lostAfter: 25 },
} satisfies Record<string, AlignConfig>;
export type ProfileName = keyof typeof PROFILES;

type MoveKind = 'start' | 'advance' | 'skip' | 'dup' | 'ins' | 'repeat' | 'boundary' | 'jump';
interface Hyp { e: number; score: number; run: number; kind: MoveKind; skipped: number; sim: number }
/** Trace du meilleur chemin, une entrée par mot reçu : sert au mode Hifz (mots omis / remplacés / répétés). */
export interface TraceEntry { word: string; e: number; kind: MoveKind; skipped: number; sim: number }

export type AlignEventKind = 'confirmed' | 'advance' | 'skip' | 'repeat' | 'jump' | 'lost' | 'recovered';
export interface AlignEvent { kind: AlignEventKind; from: Position | null; to: Position | null; words: number }
export type AlignStatus = 'searching' | 'tracking' | 'uncertain' | 'lost';
export interface AlignState {
  status: AlignStatus;
  /** Dernière position CONFIRMÉE : c'est elle qu'on affiche. */
  position: Position | null;
  /** Meilleure hypothèse courante (non confirmée) : pour le diagnostic uniquement. */
  live: Position | null;
  confidence: number; margin: number; run: number;
  candidates: Position[];
  events: AlignEvent[];
}

export class Aligner {
  private beam: Hyp[] = [];
  private hist: string[] = [];
  private last: Hyp | null = null;       // hypothèse confirmée
  private lastPos = -1;
  private miss = 0;
  private lostFlag = false;
  private cfg: AlignConfig;
  private trace: TraceEntry[] = [];
  drainTrace(): TraceEntry[] { const t = this.trace; this.trace = []; return t; }
  constructor(private readonly db: CorpusDB, profile: ProfileName | AlignConfig = 'prayer') {
    this.cfg = typeof profile === 'string' ? PROFILES[profile] : profile;
  }
  setProfile(p: ProfileName) { this.cfg = PROFILES[p]; }
  reset() { this.trace = []; this.beam = []; this.hist = []; this.last = null; this.lastPos = -1; this.miss = 0; this.lostFlag = false; }
  /** Navigation manuelle / reprise après interruption : on repart d'une position connue sans perdre le suivi. */
  seed(index: number) {
    this.hist = []; this.beam = [{ e: index, score: 4, run: 3, kind: 'start', skipped: 0, sim: 1 }]; this.lastPos = index; this.miss = 0; this.lostFlag = false;
  }

  push(words: string[]): AlignState {
    const events: AlignEvent[] = [];
    for (const w of words) { this.step(w, events); }
    return this.snapshot(events);
  }

  private step(w: string, events: AlignEvent[]) {
    const { db, cfg } = this, W = db.words, N = W.length;
    this.hist.push(w); if (this.hist.length > 12) this.hist.shift();
    const next = new Map<number, Hyp>();
    const put = (e: number, score: number, run: number, kind: MoveKind, skipped: number, sm = 0) => {
      if (e < 0 || e >= N) return;
      const o = next.get(e);
      if (!o || score > o.score) next.set(e, { e, score, run, kind, skipped, sim: sm });
    };
    const src = this.beam;
    for (const h of src) {
      const base = h.score * cfg.decay;
      const cand = (e: number, pen: number, kind: MoveKind, skipped: number, allowMis: boolean) => {
        if (e < 0 || e >= N) return;
        const s = db.simOf(w, W[e].t);
        if (s >= cfg.matchMin) put(e, base + s + pen, h.run + 1, kind, skipped, s);
        else if (allowMis) put(e, base + cfg.mismatch + pen, 0, kind, skipped, s);
      };
      cand(h.e + 1, 0, 'advance', 0, true);
      cand(h.e + 2, cfg.skip, 'skip', 1, false);
      cand(h.e + 3, cfg.skip * 2, 'skip', 2, false);
      cand(h.e, cfg.dup, 'dup', 0, false);
      put(h.e, base + cfg.ins, h.run, 'ins', 0, 0); // mot parasite : on reste, sans pénaliser le suivi
      const vs = db.verseStart(h.e);
      if (vs !== h.e) cand(vs, cfg.restart, 'repeat', 0, false);
      const pv = db.verses[db.words[h.e].v - 1];
      if (pv && pv.words.length) cand(pv.start, cfg.restart - 0.3, 'repeat', 0, false);
      if (db.isBoundary(h.e)) for (const st of db.surahStarts) if (st !== h.e + 1) cand(st, cfg.boundary, 'boundary', 0, false);
    }
    // injection de candidats lointains (récupération), depuis l'index de trigrammes / bigrammes
    const n = Math.min(db.gramMain, this.hist.length);
    if (n >= db.gramSmall) {
      const tail = this.hist.slice(-n);
      const idx = n === db.gramMain ? db.idxMain : db.idxSmall;
      const key = tail.map(t => db.keyOf(t)).join(' ');
      const list = idx.get(key);
      if (list && list.length <= (n === db.gramMain ? 150 : 60)) {
        const near = (e: number) => src.some(h => Math.abs(h.e - e) <= 40);
        for (const e of list) {
          let sc = 0, run = 0, d = 1, ok = 0;
          for (let k = 0; k < n; k++) {
            const t = W[e - k]; if (!t) break;
            const s = db.simOf(tail[n - 1 - k], t.t);
            if (s >= cfg.matchMin) { sc += d * s; run++; ok++; } else sc += d * cfg.mismatch;
            d *= cfg.decay;
          }
          if (ok < n - 1) continue;
          put(e, sc + (near(e) ? cfg.jumpNear : cfg.jumpFar), run, 'jump', 0, 1);
        }
      }
    }
    let arr = [...next.values()].sort((a, b) => b.score - a.score);
    if (arr.length) { const top = arr[0].score; arr = arr.filter(h => h.score >= top - 8).slice(0, cfg.beam); }
    this.beam = arr;
    if (arr[0]) { this.trace.push({ word: w, e: arr[0].e, kind: arr[0].kind, skipped: arr[0].skipped, sim: arr[0].sim }); if (this.trace.length > 800) this.trace.shift(); }
    this.evaluate(events);
  }

  private evaluate(events: AlignEvent[]) {
    const { cfg, db } = this, top = this.beam[0];
    if (!top) { this.miss++; this.checkLost(events); return; }
    const other = this.beam.find(h => h.e !== top.e && db.words[h.e].v !== db.words[top.e].v);
    const margin = other ? top.score - other.score : 3;
    const forwardNear = this.lastPos >= 0 && top.e >= this.lastPos - 0 && top.e - this.lastPos <= 6;
    let ok: boolean;
    if (this.lastPos < 0) ok = top.run >= cfg.runInit && margin >= cfg.marginInit;
    else if (forwardNear) ok = top.run >= cfg.runNear && margin >= cfg.marginNear;
    else ok = top.run >= cfg.runFar && margin >= cfg.marginFar;
    if (top.e === this.lastPos) { this.miss = top.run > 0 ? 0 : this.miss; if (top.run > 0 && this.lostFlag) { this.lostFlag = false; events.push({ kind: 'recovered', from: null, to: db.position(top.e), words: 0 }); } return; }
    if (ok) {
      const from = this.lastPos >= 0 ? db.position(this.lastPos) : null, to = db.position(top.e);
      let kind: AlignEventKind = 'confirmed';
      if (from) {
        if (top.e > this.lastPos && top.e - this.lastPos <= 6) kind = top.e - this.lastPos > 1 ? 'skip' : 'advance';
        else if (top.e <= this.lastPos && this.lastPos - top.e <= 60) kind = 'repeat';
        else kind = 'jump';
      }
      events.push({ kind, from, to, words: from ? top.e - this.lastPos : 0 });
      if (this.lostFlag) { this.lostFlag = false; events.push({ kind: 'recovered', from, to, words: 0 }); }
      this.last = top; this.lastPos = top.e; this.miss = 0;
    } else {
      this.miss = top.run === 0 ? this.miss + 1 : Math.max(0, this.miss - 1);
      this.checkLost(events);
    }
  }
  private checkLost(events: AlignEvent[]) {
    if (!this.lostFlag && this.lastPos >= 0 && this.miss >= this.cfg.lostAfter) {
      this.lostFlag = true; events.push({ kind: 'lost', from: this.db.position(this.lastPos), to: null, words: 0 });
    }
  }

  private snapshot(events: AlignEvent[]): AlignState {
    const { db } = this, top = this.beam[0];
    const seen = new Set<number>(), cands: Position[] = [];
    for (const h of this.beam) { const v = db.words[h.e].v; if (!seen.has(v)) { seen.add(v); cands.push(db.position(h.e)); if (cands.length >= 3) break; } }
    const other = top && this.beam.find(h => h.e !== top.e && db.words[h.e].v !== db.words[top.e].v);
    const margin = top ? (other ? top.score - other.score : 3) : 0;
    const conf = top ? (1 / (1 + Math.exp(-(margin - 0.5)))) * Math.min(1, top.run / 3) : 0;
    const status: AlignStatus = this.lastPos < 0 ? 'searching' : this.lostFlag ? 'lost' : (top && top.e === this.lastPos) || conf >= 0.5 ? 'tracking' : 'uncertain';
    return { status, position: this.lastPos >= 0 ? db.position(this.lastPos) : null, live: top ? db.position(top.e) : null, confidence: conf, margin, run: top ? top.run : 0, candidates: cands, events };
  }
}
