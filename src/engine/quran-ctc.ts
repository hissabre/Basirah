import type { RecognitionEngine, RecognizerEvents, RecognitionResult, RecognizerState, CtcVocab } from '../types.ts';
import { StreamingFbank } from '../audio/fbank.ts';
import type { WorkerLike } from './whisper.ts';

export interface QuranCtcOptions {
  spawn: () => Promise<WorkerLike> | WorkerLike;
  /** Fichiers du modèle, essayés dans l'ordre (embarqué dans l'application d'abord, puis Hugging Face). */
  models: string[]; tokens: string[];
  /** Dossiers d'ONNX Runtime Web, essayés dans l'ordre (copie publiée avec l'application, puis CDN). */
  ort?: string[];
  /** Contexte donné au modèle à chaque passe (s). */
  windowSec?: number;
  /** Pas minimal entre deux passes (s) ; s'allonge tout seul si l'appareil est lent. */
  minHopSec?: number;
  /** Les images les plus récentes (sans contexte à droite) ne sont transmises qu'à la passe suivante (s). */
  guardSec?: number;
  /** Silence ajouté après l'audio à chaque passe (s) : le modèle, non conçu pour le flux, reconnaît bien mieux la fin de la fenêtre. */
  padSec?: number;
  id?: string;
}

/** Lit tokens.txt (format sherpa-onnx « symbole identifiant »). Séparateur de mots = tout symbole qui n'est pas une lettre arabe. */
export function parseTokens(txt: string): CtcVocab {
  const tokens: string[] = []; let blank = -1; const fold: number[] = [];
  for (const raw of txt.split(/\r?\n/)) {
    if (!raw.trim()) continue; const m = /^(.*?)\s*(\d+)\s*$/.exec(raw); if (!m) continue;
    const sym = m[1] === '' ? ' ' : m[1], id = +m[2]; tokens[id] = sym;
  }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i] ?? '';
    if (/^<(blk|blank|eps)>$/i.test(t)) { if (blank < 0) blank = i; continue; }
    if (!/^[ء-يٱ]$/.test(t)) fold.push(i);
  }
  if (blank < 0) blank = 0;
  return { tokens: tokens.map(t => t ?? ''), blank, fold: fold.filter(i => i !== blank) };
}

/**
 * Moteur hors ligne « Coran » : modèle acoustique CTC de lettres (quran-asr-tiny, 16 M paramètres) dans un worker,
 * fenêtre glissante (8 s, + 0,8 s de silence ajouté) relancée toutes les ~0,25 s, fbank calculées une seule fois en flux.
 * Il NE fabrique PAS de texte : il transmet à la session les probabilités de lettres de chaque image (≈ 40 ms),
 * que le suivi contraint par le texte du Coran (CtcTracker) transforme en position. Retard visé : ≈ 0,3–0,5 s.
 */
export class QuranCtcEngine implements RecognitionEngine {
  readonly kind = 'offline' as const; readonly id: string;
  private fns: { [K in keyof RecognizerEvents]?: RecognizerEvents[K][] } = {};
  private w: WorkerLike | null = null; private fb = new StreamingFbank(); private base: number | null = null;
  private busy = false; private ready = false; private lastRunFrame = 0; private runId = 0; private hop: number;
  private peak = 0; private lat: number[] = []; private win = 8; private flushWait: (() => void) | null = null; private finalRun = false;
  vocab: CtcVocab | null = null; info: Record<string, unknown> = {}; runs = 0; skippedSilent = 0; frames = 0; lastMs: number | null = null;
  constructor(private o: QuranCtcOptions) { this.id = o.id ?? 'quran-asr-tiny (hors ligne)'; this.hop = o.minHopSec ?? 0.24; this.win = o.windowSec ?? 8; }
  on<K extends keyof RecognizerEvents>(ev: K, fn: RecognizerEvents[K]) { (this.fns[ev] ??= [] as never).push(fn as never); }
  private st(s: RecognizerState, why: string) { (this.fns.state as ((s: string, w: string) => void)[] | undefined)?.forEach(f => f(s, why)); }

  async load() {
    this.st('loading-model', 'chargement du modèle Coran (≈ 19 Mo, une seule fois ; ensuite hors ligne)…');
    const w = await this.o.spawn(); this.w = w;
    await new Promise<void>((res, rej) => {
      w.onmessage = e => {
        const d = e.data;
        if (d.prog) { this.st('loading-model', `${d.prog.label} : ${d.prog.cached ? 'déjà sur l\'appareil' : d.prog.pct + ' %'}`); return; }
        if (d.err) { rej(new Error('moteur Coran : ' + d.err)); return; }
        if (d.ready) { this.vocab = parseTokens(d.tokens); this.info = { modele: d.url, jetons: d.tokUrl, runtime: d.lib, threads: d.threads, io: d.io, chauffeMs: d.warmMs }; this.ready = true; res(); }
      };
      w.onerror = (e: any) => rej(new Error('worker : ' + (e?.message ?? e)));
      w.postMessage({ init: 1, models: this.o.models, tokens: this.o.tokens, ort: this.o.ort });
    });
    w.onmessage = e => this.onWorker(e.data);
    this.st('listening', `prêt (${this.vocab!.tokens.length} symboles, ${String(this.info.threads)} fil(s), passe d'essai ${String(this.info.chauffeMs)} ms)`);
  }

  pushAudio(pcm: Float32Array, audioStart: number) {
    if (this.base === null) this.base = audioStart;
    for (let i = 0; i < pcm.length; i++) { const a = Math.abs(pcm[i]); if (a > this.peak) this.peak = a; }
    this.fb.push(pcm); this.maybeRun();
  }
  private maybeRun() {
    if (!this.ready || this.busy || !this.w) return;
    const F = this.fb.framesDone, W = Math.min(F, Math.round(this.win * 100));
    if (!this.finalRun && (F - this.lastRunFrame < this.hop * 100 || W < 50)) return;
    const base = this.base ?? 0;
    if (!this.finalRun && this.peak < 0.004) { // silence : rien à reconnaître, on économise la batterie
      this.skippedSilent++; this.lastRunFrame = F; this.peak = 0; return;
    }
    const x = this.fb.slice(F - W, F), voiced = this.peak > 0.02; this.peak = 0;
    this.busy = true; this.lastRunFrame = F; this.runs++;
    this.w.postMessage({ run: 1, x, T: W, t0: base + (F - W) * 0.01, t1: base + F * 0.01, pad: Math.round((this.o.padSec ?? 0.8) * 100), id: ++this.runId, voiced }, [x.buffer]);
  }
  private onWorker(d: any) {
    if (d.cal) { this.info.echelle = d.cal; return; }
    this.busy = false;
    if (d.err) { this.st('error', 'moteur Coran : ' + d.err); return; }
    if (!d.lp) return;
    this.lastMs = d.ms; this.lat.push(d.ms); if (this.lat.length > 50) this.lat.shift();
    this.hop = Math.max(this.o.minHopSec ?? 0.24, Math.min(1.2, d.ms / 1000 * 1.15));
    // appareil lent (lunettes) : fenêtre plus courte (6 s, mesuré presque aussi juste) ; revient à la normale si la passe redevient rapide
    if (d.ms > 650 && this.win > 6) this.win = 6; else if (d.ms < 250 && this.win < (this.o.windowSec ?? 8)) this.win = this.o.windowSec ?? 8;
    const n: number = d.n, V: number = d.V, lp: Float32Array = d.lp, dt = (d.t1 - d.t0 + (d.pad ?? 0) * 0.01) / Math.max(1, n);
    // Lettres de TOUTE la fenêtre avec leur instant (le flux de lettres décide lesquelles sont sûres) ; l'audio réel s'arrête à t1.
    const v = this.vocab!, letters: { id: number; t: number }[] = []; let prev = -1;
    for (let k = 0; k < n; k++) {
      const t = d.t0 + (k + 0.5) * dt; if (t > d.t1 + 0.02) break;
      let g = 0; for (let i = 1; i < V; i++) if (lp[k * V + i] > lp[k * V + g]) g = i;
      if (g !== prev && g !== v.blank && !v.fold.includes(g)) letters.push({ id: g, t }); prev = g;
    }
    this.frames += n;
    const r: RecognitionResult = { text: '', unit: 'ctc', ctc: { letters, end: d.t1, vocab: v }, language: 'ar', audioStart: d.t0, audioEnd: d.t1, receivedAt: performance.now(), isFinal: true, confidence: null, engine: 'offline', engineId: this.id };
    (this.fns.result as ((r: RecognitionResult) => void)[] | undefined)?.forEach(f => f(r));
    if (this.finalRun) { this.finalRun = false; const f = this.flushWait; this.flushWait = null; f?.(); return; }
    this.maybeRun();
  }
  /** Dernière passe sans marge à droite : tout l'audio reçu est transmis. */
  async flush() {
    if (!this.ready || !this.w) return;
    for (let i = 0; i < 100 && this.busy; i++) await new Promise(r => setTimeout(r, 20));
    if (this.fb.framesDone < 50) return;
    await new Promise<void>(res => { this.flushWait = res; this.finalRun = true; this.maybeRun(); setTimeout(() => { if (this.flushWait === res) { this.flushWait = null; this.finalRun = false; res(); } }, 3000); });
  }
  async dispose() { try { this.w?.terminate?.(); } catch { /* */ } this.w = null; this.ready = false; }
  stats() {
    const l = [...this.lat].sort((a, b) => a - b);
    return { queued: this.busy ? 1 : 0, lastLatencyMs: this.lastMs, passeMediane: l.length ? Math.round(l[l.length >> 1]) : null, pas: +this.hop.toFixed(2), passes: this.runs, fenetre: this.win, silences: this.skippedSilent, images: this.frames, ...this.info } as { queued: number; lastLatencyMs: number | null };
  }
}

/** Worker classique depuis une chaîne (importScripts du CDN autorisé). */
export function spawnClassicWorker(src: string): WorkerLike {
  return new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))) as unknown as WorkerLike;
}
