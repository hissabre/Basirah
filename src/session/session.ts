import type { RecognitionEngine, RecognitionResult, RecognizerState, CtcVocab } from '../types.ts';
import { buildTokenCorpus } from '../decoder/ctc-tracker.ts';
import { LetterLocator, type LocatorOptions } from '../decoder/letter-locator.ts';
import { buildLetterCorpus, type LetterCorpus } from '../quran/letters.ts';
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
  engine: { id: string; kind: string; state: RecognizerState | 'none'; unit: 'text' | 'phoneme' | 'ctc' | null } | null;
  /** Moteur acoustique (ctc) : derniers caractères entendus par le modèle (affichage « en direct », non corrigé). */
  heard: string;
  /** Meilleure hypothèse courante, NON confirmée (affichage provisoire, plus rapide que la position confirmée). */
  live: { surah: number; ayah: number; word: number; index: number } | null;
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
  private stab = new Stabilizer(2); private liveP: SessionView['position'] = null;
  /** Réactivité : false = sûre (2 hypothèses d'accord), true = rapide (tous les mots sauf le dernier). */
  setReactivity(fast: boolean) { this.stab = new Stabilizer(2, fast); this.note('réactivité : ' + (fast ? 'rapide' : 'sûre')); this.emit(); }
  private engine: RecognitionEngine | null = null; private engState: RecognizerState | 'none' = 'none'; private unit: 'text' | 'phoneme' | 'ctc' | null = null;
  private ctc: { vocab: CtcVocab; tr: LetterLocator; lc: LetterCorpus; fold: Float32Array; blank: number } | null = null; private heard = ''; private lastJump = -1;
  /** Réglages du suivi acoustique (tests, calibrage). */
  trackerOptions: LocatorOptions = {};
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
  /** Nouvelle prise : oublie la position et les hypothèses de l'écoute précédente (le mode et le moteur sont conservés). */
  reset() {
    this.wordAl = new Aligner(this.d.quran, 'prayer'); this.phAl = this.d.phoneme ? new Aligner(this.d.phoneme, 'phoneme') : null;
    if (this.mode !== 'translation') this.wordAl.setProfile((this.mode === 'prayer' ? 'prayer' : this.mode === 'hifz' ? 'hifz' : 'reading') as ProfileName);
    this.pos = null; this.liveP = null; this.status = 'idle'; this.conf = 0; this.margin = 0; this.events = []; this.stuck = null; this.ctc?.tr.reset(); this.heard = ''; this.stab.reset(); this.note('nouvelle prise : position remise à zéro'); this.emit();
  }
  /** Navigation manuelle (Lecture) ou reprise : fixe la position sans perdre le suivi. */
  goto(surah: number, ayah: number, word = 0) {
    const i = this.d.quran.indexOf(surah, ayah, word); if (i < 0) { this.note(`goto ${surah}:${ayah} : inexistant`); return false; }
    this.seedAll(i); this.pos = this.d.quran.position(i); this.status = 'tracking'; this.stab.reset(); this.note(`position fixée à ${surah}:${ayah}`); this.emit(); return true;
  }
  private seedAll(qIdx: number) {
    this.wordAl.seed(qIdx); if (this.ctc) this.ctc.tr.startAt(this.ctc.lc.wordFirst[qIdx]);
    if (this.phAl && this.d.phoneme) { const p = this.d.quran.position(qIdx), u = this.d.phoneme.unitIndexOf(p.surah, p.ayah, p.word); if (u >= 0) this.phAl.seed(u); }
  }

  /** Branche un moteur (explicitement). La position confirmée est transmise au nouvel aligneur ; l'ancien moteur doit être arrêté par l'appelant. */
  attachEngine(e: RecognitionEngine, unit: 'text' | 'phoneme' | 'ctc') {
    if (this.engine) this.note(`changement de moteur : ${this.engine.id} → ${e.id}`); else this.note('moteur : ' + e.id);
    this.engine = e; this.unit = unit; this.stab.reset();
    if (this.pos) this.seedAll(this.pos.index);
    e.on('result', r => this.onResult(r));
    e.on('state', (s, why) => { this.engState = s; this.note(`moteur ${e.id} : ${s} — ${why}`); if (s === 'listening') this.stab.reset(); this.emit(); });
  }

  onResult(r: RecognitionResult) {
    this.clock = r.audioEnd;
    if (this.mode === 'translation') { this.d.translation?.push(r); this.emit(); return; }
    if (r.unit === 'ctc') { this.onCtc(r); return; }
    const phon = r.unit === 'phoneme';
    const al = phon ? this.phAl : this.wordAl;
    if (!al) { this.note('résultat phonémique reçu mais aucun lexique phonémique chargé : ignoré'); return; }
    const words = this.stab.push(r); if (!words.length) return;
    const st = al.push(words);
    for (const ev of st.events) { this.events.push({ ...ev, at: r.audioEnd }); if (this.events.length > 30) this.events.shift(); }
    if (st.position) this.pos = phon ? this.fromPhoneme(st.position.index) : this.d.quran.position(st.position.index);
    this.status = st.status; this.conf = st.confidence; this.margin = st.margin;
    this.liveP = st.live ? (phon ? this.fromPhoneme(st.live.index) : this.d.quran.position(st.live.index)) : null;
    const tr = al.drainTrace();
    if (!phon && this.mode === 'hifz') { this.hifz.consume(tr, r.audioEnd); this.stuck = null; }
    this.emit();
  }
  /** Corpus de lettres + suivi, construits une fois par vocabulaire de modèle (≈ 0,3 s). */
  private ensureCtc(v: CtcVocab) {
    if (this.ctc && this.ctc.vocab === v) return this.ctc;
    const id = new Map<string, number>(); v.tokens.forEach((t, i) => { if (i !== v.blank && !v.fold.includes(i) && t) id.set(t, i); });
    const lc = buildLetterCorpus(this.d.quran, ch => id.has(ch));
    const tc = buildTokenCorpus(lc.units, id, v.blank, v.tokens.length, 99);
    const groups = ['سثص', 'ذزظض', 'تط', 'كق', 'حهخ', 'عغ', 'دض', 'اء'].map(g => [...g].map(c => id.get(c)).filter((x): x is number => x !== undefined));
    const tr = new LetterLocator(tc.ids, v.blank, v.tokens.length, groups, this.trackerOptions);
    this.ctc = { vocab: v, tr, lc, fold: new Float32Array(v.tokens.length), blank: v.blank };
    this.note(`suivi acoustique : ${lc.units.length} lettres, vocabulaire ${v.tokens.length} (${[...id.keys()].join('')})`);
    if (this.pos) tr.startAt(lc.wordFirst[this.pos.index]);
    return this.ctc;
  }
  /** Moteur acoustique : chaque image (≈ 40 ms) fait avancer le suivi dans le texte du Coran ; la position n'est confirmée que verrouillée. */
  private onCtc(r: RecognitionResult) {
    const c = r.ctc; if (!c || !c.frames.length) return;
    const k = this.ensureCtc(c.vocab), { tr, lc } = k, V = c.vocab.tokens.length;
    let out = null as ReturnType<LetterLocator['push']>;
    for (let f = 0; f < c.frames.length; f++) {
      let lp = c.frames[f];
      if (c.vocab.fold.length) { // le séparateur de mots compte comme un blanc (les limites de mots ne sont pas utiles au suivi)
        const x = k.fold; x.set(lp); let a = x[k.blank]; for (const j of c.vocab.fold) { const b = x[j]; const m = Math.max(a, b); a = m + Math.log(Math.exp(a - m) + Math.exp(b - m)); x[j] = -1e9; } x[k.blank] = a; lp = x;
      }
      out = tr.push(lp) ?? out;
    }
    if (r.text) { this.heard = (this.heard + r.text).slice(-60); }
    if (out && out.index >= 0) {
      const w = lc.unitWord[out.index], bas = lc.basmala[out.index] === 1;
      this.liveP = bas ? null : this.d.quran.position(w);
      this.margin = Number.isFinite(out.margin) ? out.margin : 99; this.conf = out.letters ? Math.max(0, 1 - out.cost / out.letters) : 0;
      if (out.locked && !bas) {
        const prev = this.pos, np = this.d.quran.position(w);
        if (!prev || prev.index !== np.index) {
          const jump = !!prev && (np.index < prev.index || np.index > prev.index + 8);
          if (!prev || jump) { this.events.push({ kind: prev ? 'jump' : 'confirmed', from: prev, to: np, words: prev ? np.index - prev.index : 0, at: r.audioEnd } as AlignEvent & { at: number }); if (this.events.length > 30) this.events.shift(); }
          this.pos = np;
        }
        this.status = 'tracking';
      } else this.status = this.pos ? 'uncertain' : 'searching';
    }
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
    return { mode: this.mode, status: this.status, position: this.pos, live: this.liveP, confidence: this.conf, margin: this.margin,
      engine: this.engine ? { id: this.engine.id, kind: this.engine.kind, state: this.engState, unit: this.unit } : null,
      recentEvents: this.events.slice(-8), heard: this.heard, hifz: this.mode === 'hifz' ? this.hifz.summary() : null, stuck: this.stuck };
  }
}
