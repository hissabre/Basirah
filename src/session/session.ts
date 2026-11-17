import type { RecognitionEngine, RecognitionResult, RecognizerState } from '../types.ts';
import { QuranDB } from '../quran/db.ts';
import { PhonemeDB, lexiconCompat } from '../quran/phoneme-db.ts';
import { Aligner, type AlignEvent, type AlignStatus, type ProfileName } from '../align/aligner.ts';
import { Stabilizer } from '../align/stabilizer.ts';
import { HifzTracker } from './hifz.ts';
import type { TranslationPipeline } from '../translation/pipeline.ts';

export type Mode = 'prayer' | 'hifz' | 'reading' | 'translation';
export interface SessionDeps { quran: QuranDB; phoneme?: PhonemeDB | null; translation?: TranslationPipeline | null }
export interface SessionView {
  mode: Mode; status: AlignStatus | 'idle';
  /** Position CONFIRMÉE, exprimée dans la base de texte (la seule qu'affiche l'interface). */
  position: { surah: number; ayah: number; word: number; index: number } | null;
  confidence: number; margin: number;
  engine: { id: string; kind: string; state: RecognizerState | 'none'; unit: 'text' | 'phoneme' | null } | null;
  recentEvents: (AlignEvent & { at: number })[];
  hifz: ReturnType<HifzTracker['summary']> | null; stuck: { hint: string[] } | null;
}
export interface LogLine { at: number; msg: string }

/**
 * Cœur unifié : reçoit les résultats de N'IMPORTE QUEL moteur (texte ou phonèmes, en ligne ou hors ligne), les passe par
 * Stabilizer → Aligner, conserve UNE position, et expose les 4 modes. Changer de moteur ne remet pas la position à zéro.
 */
export class Session {
  mode: Mode = 'prayer';
  readonly log: LogLine[] = [];
  readonly hifz: HifzTracker;
  private wordAl: Aligner; private phAl: Aligner | null;
  private stab = new Stabilizer(2);
  private engine: RecognitionEngine | null = null; private engState: RecognizerState | 'none' = 'none'; private unit: 'text' | 'phoneme' | null = null;
  private pos: SessionView['position'] = null; private status: AlignStatus | 'idle' = 'idle'; private conf = 0; private margin = 0;
  private events: (AlignEvent & { at: number })[] = []; private stuck: { hint: string[] } | null = null; private clock = 0;
  private fns: ((v: SessionView) => void)[] = [];
  readonly compat: { mismatchedVerses: number; total: number } | null;
  constructor(private readonly d: SessionDeps) {
    this.wordAl = new Aligner(d.quran, 'prayer');
    this.phAl = d.phoneme ? new Aligner(d.phoneme, 'phoneme') : null;
    this.hifz = new HifzTracker(d.quran);
    this.compat = d.phoneme ? lexiconCompat(d.quran, d.phoneme) : null;
    if (this.compat && this.compat.mismatchedVerses) this.note(`lexique phonémique : ${this.compat.mismatchedVerses} versets dont la segmentation en mots diffère du texte — conversion de position dégradée (début de verset)`);
  }
  private note(msg: string) { this.log.push({ at: this.clock, msg }); if (this.log.length > 500) this.log.shift(); }
  onUpdate(f: (v: SessionView) => void) { this.fns.push(f); }
  private emit() { const v = this.view(); this.fns.forEach(f => f(v)); }

  setMode(m: Mode) {
    this.mode = m; this.note('mode : ' + m);
    if (m !== 'translation') this.wordAl.setProfile((m === 'prayer' ? 'prayer' : m === 'hifz' ? 'hifz' : 'reading') as ProfileName);
    this.emit();
  }
  /** Navigation manuelle (Lecture) ou reprise : fixe la position sans perdre le suivi. */
  goto(surah: number, ayah: number, word = 0) {
    const i = this.d.quran.indexOf(surah, ayah, word); if (i < 0) { this.note(`goto ${surah}:${ayah} : inexistant`); return false; }
    this.seedAll(i); this.pos = this.d.quran.position(i); this.status = 'tracking'; this.stab.reset(); this.note(`position fixée à ${surah}:${ayah}`); this.emit(); return true;
  }
  private seedAll(qIdx: number) {
    this.wordAl.seed(qIdx);
    if (this.phAl && this.d.phoneme) { const p = this.d.quran.position(qIdx), u = this.d.phoneme.unitIndexOf(p.surah, p.ayah, p.word); if (u >= 0) this.phAl.seed(u); }
  }

  /** Branche un moteur (explicitement). La position confirmée est transmise au nouvel aligneur ; l'ancien moteur doit être arrêté par l'appelant. */
  attachEngine(e: RecognitionEngine, unit: 'text' | 'phoneme') {
    if (this.engine) this.note(`changement de moteur : ${this.engine.id} → ${e.id}`); else this.note('moteur : ' + e.id);
    this.engine = e; this.unit = unit; this.stab.reset();
    if (this.pos) this.seedAll(this.pos.index);
    e.on('result', r => this.onResult(r));
    e.on('state', (s, why) => { this.engState = s; this.note(`moteur ${e.id} : ${s} — ${why}`); if (s === 'listening') this.stab.reset(); this.emit(); });
  }

  onResult(r: RecognitionResult) {
    this.clock = r.audioEnd;
    if (this.mode === 'translation') { this.d.translation?.push(r); this.emit(); return; }
    const phon = r.unit === 'phoneme';
    const al = phon ? this.phAl : this.wordAl;
    if (!al) { this.note('résultat phonémique reçu mais aucun lexique phonémique chargé : ignoré'); return; }
    const words = this.stab.push(r); if (!words.length) return;
    const st = al.push(words);
    for (const ev of st.events) { this.events.push({ ...ev, at: r.audioEnd }); if (this.events.length > 30) this.events.shift(); }
    if (st.position) this.pos = phon ? this.fromPhoneme(st.position.index) : this.d.quran.position(st.position.index);
    this.status = st.status; this.conf = st.confidence; this.margin = st.margin;
    const tr = al.drainTrace();
    if (!phon && this.mode === 'hifz') { this.hifz.consume(tr, r.audioEnd); this.stuck = null; }
    this.emit();
  }
  private fromPhoneme(u: number) {
    const w = this.d.phoneme!.wordOf(u); const qi = this.d.quran.indexOf(w.surah, w.ayah, w.word);
    return qi >= 0 ? this.d.quran.position(qi) : null;
  }
  /** À appeler régulièrement avec l'horloge audio : détecte le blocage en Hifz. */
  tick(nowSec: number) {
    this.clock = nowSec;
    if (this.mode === 'hifz' && this.pos) { const s = this.hifz.checkStuck(nowSec, this.pos.index); if (s.stuck) { this.stuck = { hint: s.hint }; this.events.push({ kind: 'lost', from: this.pos, to: null, words: 0, at: nowSec }); this.note('Hifz : récitant bloqué'); this.emit(); } }
  }
  /** Continuation correcte à la demande (texte original). */
  hint(n = 3): string[] { return this.pos ? this.hifz.next(this.pos.index, n) : []; }

  view(): SessionView {
    return { mode: this.mode, status: this.status, position: this.pos, confidence: this.conf, margin: this.margin,
      engine: this.engine ? { id: this.engine.id, kind: this.engine.kind, state: this.engState, unit: this.unit } : null,
      recentEvents: this.events.slice(-8), hifz: this.mode === 'hifz' ? this.hifz.summary() : null, stuck: this.stuck };
  }
}
