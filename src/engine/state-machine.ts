import type { RecognizerState } from '../types.ts';

/** Transitions autorisées : toute autre transition est une erreur de programmation et est refusée (jamais silencieuse). */
const ALLOWED: Record<RecognizerState, RecognizerState[]> = {
  'idle': ['requesting-mic', 'initializing', 'error'],
  'requesting-mic': ['initializing', 'idle', 'error'],
  'initializing': ['loading-model', 'listening', 'idle', 'error'],
  'loading-model': ['listening', 'idle', 'error'],
  'listening': ['processing', 'recovering', 'network-disconnected', 'mic-interrupted', 'idle', 'error'],
  'processing': ['listening', 'recovering', 'network-disconnected', 'mic-interrupted', 'idle', 'error'],
  'recovering': ['listening', 'loading-model', 'network-disconnected', 'mic-interrupted', 'idle', 'error'],
  'network-disconnected': ['recovering', 'listening', 'idle', 'error'],
  'mic-interrupted': ['recovering', 'listening', 'idle', 'error'],
  'error': ['idle', 'initializing'],
};

export interface LogEntry { at: number; from: RecognizerState; to: RecognizerState; reason: string }

/**
 * État unique de la session de reconnaissance + journal de chaque transition (cause comprise) + limite de reprises :
 * au-delà de `maxRecoveries` tentatives dans `windowMs`, la machine passe en `error` au lieu de boucler.
 */
export class RecognizerFSM {
  state: RecognizerState = 'idle';
  readonly log: LogEntry[] = [];
  private recoveries: number[] = [];
  private fns: ((s: RecognizerState, reason: string) => void)[] = [];
  constructor(private readonly now: () => number = () => Date.now(), private readonly maxRecoveries = 3, private readonly windowMs = 60_000) {}
  on(fn: (s: RecognizerState, reason: string) => void) { this.fns.push(fn); }

  to(next: RecognizerState, reason: string): boolean {
    if (next === this.state) return true;
    if (!ALLOWED[this.state].includes(next)) {
      this.record(this.state, this.state, `transition refusée ${this.state}→${next} (${reason})`);
      return false;
    }
    if (next === 'recovering') {
      const t = this.now();
      this.recoveries = this.recoveries.filter(x => t - x < this.windowMs);
      if (this.recoveries.length >= this.maxRecoveries) {
        return this.to('error', `trop de reprises (${this.maxRecoveries} en ${this.windowMs / 1000} s) — dernière cause : ${reason}`);
      }
      this.recoveries.push(t);
    }
    const from = this.state; this.state = next; this.record(from, next, reason);
    this.fns.forEach(f => f(next, reason));
    return true;
  }
  private record(from: RecognizerState, to: RecognizerState, reason: string) { this.log.push({ at: this.now(), from, to, reason }); if (this.log.length > 500) this.log.shift(); }
}
