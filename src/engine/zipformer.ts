import type { RecognitionEngine, RecognitionResult, RecognizerEvents, RecognizerState } from '../types.ts';
import type { SherpaBackend } from './sherpa.ts';

export interface ZipformerOptions {
  id?: string;
  /** Retard maximal toléré en file (secondes d'audio). Au-delà, les blocs les plus anciens sont abandonnés ET comptés (jamais silencieux). */
  maxBacklogSec?: number;
  now?: () => number;
}

/**
 * Moteur de reconnaissance Quran-Lab Zipformer (streaming, sortie en phonèmes) au-dessus d'un `SherpaBackend`.
 * - chaque bloc audio est donné au flux dès son arrivée : aucune fenêtre, aucun chevauchement, aucun lot ;
 * - un seul traitement à la fois (contre-pression) ; file bornée ; abandon explicite si retard excessif ;
 * - ne touche jamais au micro ; ne redémarre jamais seul : une erreur est signalée et la décision revient à l'appelant.
 */
export class ZipformerEngine implements RecognitionEngine {
  readonly kind = 'offline' as const;
  readonly id: string;
  private handlers: { [K in keyof RecognizerEvents]?: RecognizerEvents[K][] } = {};
  private queue: { pcm: Float32Array; start: number; at: number }[] = [];
  private busy = false; private loaded = false; private disposed = false;
  private seg: { start: number; tokens: string[] } = { start: 0, tokens: [] };
  private fresh = true;
  droppedSec = 0; blocks = 0; procMs = 0; audioSec = 0; lastLat: number | null = null; maxLat = 0;
  private flushWaiters: (() => void)[] = [];
  private readonly maxBacklog: number; private readonly now: () => number;
  constructor(private readonly backend: SherpaBackend, o: ZipformerOptions = {}) {
    this.id = o.id ?? 'sherpa-onnx:quranlab-zipformer'; this.maxBacklog = o.maxBacklogSec ?? 5; this.now = o.now ?? (() => performance.now());
  }
  on<K extends keyof RecognizerEvents>(ev: K, fn: RecognizerEvents[K]) { (this.handlers[ev] ??= [] as never).push(fn as never); }
  private emit<K extends keyof RecognizerEvents>(ev: K, ...a: Parameters<RecognizerEvents[K]>) { (this.handlers[ev] as ((...x: unknown[]) => void)[] | undefined)?.forEach(f => f(...a)); }
  private state(s: RecognizerState, why: string) { this.emit('state', s, why); }

  async load(): Promise<void> {
    this.state('loading-model', 'chargement du modèle Zipformer');
    try { await this.backend.init(); this.loaded = true; this.state('listening', 'modèle prêt'); }
    catch (e) { this.state('error', 'échec du chargement du modèle : ' + (e as Error).message); throw e; }
  }

  pushAudio(pcm: Float32Array, audioStart: number): void {
    if (!this.loaded || this.disposed) return;
    this.queue.push({ pcm, start: audioStart, at: this.now() });
    let backlog = this.queue.reduce((x, b) => x + b.pcm.length, 0) / 16000;
    while (backlog > this.maxBacklog && this.queue.length > 1) { // retard excessif : abandon des plus anciens, compté et signalé
      const d = this.queue.shift()!; const s = d.pcm.length / 16000; backlog -= s; this.droppedSec += s;
      this.state('recovering', `retard de traitement : ${s.toFixed(2)} s d'audio abandonnées (total ${this.droppedSec.toFixed(1)} s)`);
      this.fresh = true; // le contexte audio est coupé : nouveau segment à la prochaine réception
    }
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.busy) return; this.busy = true;
    try {
      while (this.queue.length && !this.disposed) {
        const b = this.queue.shift()!;
        if (this.fresh) { this.seg = { start: b.start, tokens: [] }; this.fresh = false; }
        const t0 = this.now();
        const r = await this.backend.process(b.pcm);
        const t1 = this.now(); this.procMs += t1 - t0; this.audioSec += b.pcm.length / 16000; this.blocks++;
        this.lastLat = t1 - b.at; this.maxLat = Math.max(this.maxLat, this.lastLat);
        const changed = r.tokens.length !== this.seg.tokens.length || r.tokens.some((x, i) => x !== this.seg.tokens[i]);
        if (changed || r.endpoint) {
          this.seg.tokens = r.tokens;
          const res: RecognitionResult = {
            text: r.text, unit: 'phoneme', tokens: r.tokens, language: 'ar', audioStart: this.seg.start, audioEnd: b.start + b.pcm.length / 16000,
            receivedAt: t1, isFinal: r.endpoint, confidence: null, engine: 'offline', engineId: this.id,
          };
          this.emit('result', res);
        }
        if (r.endpoint) { await this.backend.reset(); this.fresh = true; }
      }
    } catch (e) {
      this.queue.length = 0; this.state('error', 'erreur du moteur : ' + (e as Error).message); // aucune relance automatique
    } finally {
      this.busy = false;
      if (!this.queue.length) { const w = this.flushWaiters.splice(0); w.forEach(f => f()); }
    }
  }

  flush(): Promise<void> { return this.busy || this.queue.length ? new Promise(r => this.flushWaiters.push(r)) : Promise.resolve(); }
  async dispose(): Promise<void> { this.disposed = true; this.queue.length = 0; await this.backend.dispose(); }
  stats() { return { queued: this.queue.length, lastLatencyMs: this.lastLat }; }
  /** Facteur temps réel : < 1 = plus rapide que le temps réel (indispensable pour le streaming). */
  get realTimeFactor(): number { return this.audioSec ? this.procMs / 1000 / this.audioSec : 0; }
}
