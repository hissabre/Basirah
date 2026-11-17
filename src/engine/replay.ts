import type { RecognitionEngine, RecognitionResult, RecognizerEvents } from '../types.ts';

/** Moteur de REJEU (tests, démonstrations sans micro) : émet des résultats préenregistrés quand l'horloge audio les atteint. N'est PAS de la reconnaissance. */
export class ReplayEngine implements RecognitionEngine {
  readonly kind = 'replay' as const; readonly id: string;
  private fns: { [K in keyof RecognizerEvents]?: RecognizerEvents[K][] } = {}; private i = 0; private clock = 0;
  constructor(private script: { at: number; result: Omit<RecognitionResult, 'engine' | 'engineId' | 'receivedAt'> }[], id = 'replay') { this.id = id; }
  on<K extends keyof RecognizerEvents>(ev: K, fn: RecognizerEvents[K]) { (this.fns[ev] ??= [] as never).push(fn as never); }
  async load() { (this.fns.state as ((s: string, w: string) => void)[] | undefined)?.forEach(f => f('listening', 'rejeu prêt')); }
  pushAudio(pcm: Float32Array, audioStart: number) {
    this.clock = audioStart + pcm.length / 16000;
    while (this.i < this.script.length && this.script[this.i].at <= this.clock) {
      const r: RecognitionResult = { ...this.script[this.i++].result, engine: 'replay', engineId: this.id, receivedAt: Date.now() };
      (this.fns.result as ((r: RecognitionResult) => void)[] | undefined)?.forEach(f => f(r));
    }
  }
  async flush() {} async dispose() {} stats() { return { queued: 0, lastLatencyMs: null }; }
}
