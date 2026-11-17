import type { RecognitionEngine, RecognitionResult, RecognizerEvents, RecognizerState } from '../types.ts';

export interface ProviderMessage { text: string; isFinal: boolean; /** secondes depuis le début DU FLUX courant */ start: number; end: number; confidence: number | null }
export interface CloseInfo { clean: boolean; code?: number; reason: string }
/** Un fournisseur de reconnaissance en continu (WebSocket vers le relais Basirah, ou autre). Une instance = une connexion. */
export interface StreamingProvider {
  readonly id: string;
  open(): Promise<void>;
  send(pcm16: Int16Array): void;
  close(): void;
  onMessage(cb: (m: ProviderMessage) => void): void;
  onClose(cb: (i: CloseInfo) => void): void;
}
export interface OnlineOptions {
  id?: string; language?: string;
  /** Tentatives de reconnexion avant de passer en `error` (jamais de boucle infinie). */
  maxRetries?: number; backoffMs?: number[];
  /** Audio non encore confirmé par un résultat final, renvoyé après reconnexion (secondes max). */
  replaySec?: number;
  sleep?: (ms: number) => Promise<void>; now?: () => number;
}

/**
 * Moteur EN LIGNE générique : flux continu, résultats provisoires/définitifs, reprise après coupure réseau.
 * - une seule connexion à la fois ; l'audio n'est jamais ré-envoyé en entier : seulement ce qui n'a pas reçu de résultat final (borné) ;
 * - horloge audio de session conservée à travers les reconnexions (les temps du fournisseur sont recalés) ;
 * - échec après `maxRetries` → état `error` ; la reprise manuelle est `resume()`.
 */
export class OnlineEngine implements RecognitionEngine {
  readonly kind = 'online' as const; readonly id: string;
  private fns: { [K in keyof RecognizerEvents]?: RecognizerEvents[K][] } = {};
  private prov: StreamingProvider | null = null; private connected = false; private connecting = false; private disposed = false; private failed = false;
  private ring: { pcm: Int16Array; start: number }[] = []; private ackEnd = 0; private offset = 0; private nextStart = 0;
  retries = 0; reconnects = 0; sentSec = 0; replayedSec = 0; lastLat: number | null = null;
  private readonly o: Required<Omit<OnlineOptions, 'id'>>;
  constructor(private readonly factory: () => StreamingProvider, o: OnlineOptions = {}) {
    this.id = o.id ?? 'online'; this.o = { language: 'ar', maxRetries: 5, backoffMs: [500, 1000, 2000, 4000, 8000], replaySec: 3, sleep: ms => new Promise(r => setTimeout(r, ms)), now: () => performance.now(), ...o };
  }
  on<K extends keyof RecognizerEvents>(ev: K, fn: RecognizerEvents[K]) { (this.fns[ev] ??= [] as never).push(fn as never); }
  private state(s: RecognizerState, why: string) { (this.fns.state as ((s: RecognizerState, w: string) => void)[] | undefined)?.forEach(f => f(s, why)); }

  async load(): Promise<void> {
    this.state('initializing', 'connexion au service de reconnaissance');
    this.failed = false;
    if (!(await this.connect(true))) { await this.recover('connexion initiale impossible'); }
  }
  private async connect(initial: boolean): Promise<boolean> {
    if (this.connecting || this.disposed) return false; this.connecting = true;
    const p = this.factory();
    try {
      await p.open();
      p.onMessage(m => this.onMsg(m, p)); p.onClose(i => this.onClose(i, p));
      this.prov = p; this.connected = true;
      // recalage : le flux du fournisseur commence au premier audio non confirmé que nous (re)envoyons
      const pending = this.ring.filter(b => b.start + b.pcm.length / 16000 > this.ackEnd);
      this.offset = pending.length ? pending[0].start : this.nextStart;
      for (const b of pending) { p.send(b.pcm); this.replayedSec += initial ? 0 : b.pcm.length / 16000; }
      this.state('listening', initial ? 'connecté' : 'connexion rétablie');
      return true;
    } catch (e) { this.state('network-disconnected', 'ouverture impossible : ' + (e as Error).message); try { p.close(); } catch { /* */ } return false; }
    finally { this.connecting = false; }
  }
  private async recover(why: string) {
    this.connected = false; this.prov = null;
    while (!this.disposed && this.retries < this.o.maxRetries) {
      const wait = this.o.backoffMs[Math.min(this.retries, this.o.backoffMs.length - 1)]; this.retries++;
      this.state('network-disconnected', `${why} — nouvelle tentative ${this.retries}/${this.o.maxRetries} dans ${wait} ms`);
      await this.o.sleep(wait); if (this.disposed) return;
      this.state('recovering', `tentative ${this.retries}`);
      if (await this.connect(false)) { this.reconnects++; this.retries = 0; return; }
    }
    if (!this.disposed) { this.failed = true; this.state('error', `service injoignable après ${this.o.maxRetries} tentatives (${why}) — reprise manuelle requise`); }
  }
  /** Reprise manuelle après `error`. */
  async resume() { if (!this.failed || this.disposed) return; this.retries = 0; this.failed = false; await this.recover('reprise manuelle'); }

  private onClose(i: CloseInfo, p: StreamingProvider) {
    if (p !== this.prov || this.disposed) return;
    void this.recover(`connexion fermée (${i.clean ? 'propre' : 'coupure'}, code ${i.code ?? '?'}, ${i.reason || 'sans motif'})`);
  }
  private onMsg(m: ProviderMessage, p: StreamingProvider) {
    if (p !== this.prov) return; // message d'une ancienne connexion : ignoré
    const r: RecognitionResult = { text: m.text, unit: 'text', language: this.o.language, audioStart: this.offset + m.start, audioEnd: this.offset + m.end, receivedAt: this.o.now(), isFinal: m.isFinal, confidence: m.confidence, engine: 'online', engineId: this.id };
    if (m.isFinal) this.ackEnd = Math.max(this.ackEnd, r.audioEnd);
    const lastBlockEnd = this.nextStart; this.lastLat = Math.max(0, (lastBlockEnd - r.audioEnd) * 1000);
    (this.fns.result as ((r: RecognitionResult) => void)[] | undefined)?.forEach(f => f(r));
  }

  pushAudio(pcm: Float32Array, audioStart: number): void {
    if (this.disposed) return;
    const i16 = new Int16Array(pcm.length); for (let i = 0; i < pcm.length; i++) { const v = Math.max(-1, Math.min(1, pcm[i])); i16[i] = v < 0 ? v * 0x8000 : v * 0x7fff; }
    this.nextStart = audioStart + pcm.length / 16000;
    this.ring.push({ pcm: i16, start: audioStart });
    const minStart = Math.max(this.ackEnd, this.nextStart - this.o.replaySec); // jamais plus que replaySec en attente
    while (this.ring.length && this.ring[0].start + this.ring[0].pcm.length / 16000 <= minStart) this.ring.shift();
    if (this.connected && this.prov) { this.prov.send(i16); this.sentSec += pcm.length / 16000; }
  }
  async flush() { await new Promise(r => setTimeout(r, 0)); }
  async dispose() { this.disposed = true; this.connected = false; try { this.prov?.close(); } catch { /* */ } this.prov = null; this.ring.length = 0; }
  stats() { return { queued: this.ring.length, lastLatencyMs: this.lastLat }; }
}
