import { Session, type Mode } from '../session/session.ts';
import type { Platform, EngineHandle } from '../platform/ports.ts';
import type { RecognizerState } from '../types.ts';
import type { QuranDB } from '../quran/db.ts';
import type { PhonemeDB } from '../quran/phoneme-db.ts';
import type { TranslationPipeline } from '../translation/pipeline.ts';

export interface BasirahEvents { suggestion?: (msg: string) => void; error?: (msg: string) => void }
/**
 * Composition : micro → moteur choisi → Session. Le choix « hors ligne / en ligne » est TOUJOURS explicite (selectEngine) ;
 * si le moteur actif tombe, Basirah le signale (`suggestion`) mais ne bascule jamais seule.
 */
export class Basirah {
  readonly session: Session; private cur: EngineHandle | null = null; private kind: 'offline' | 'online' | null = null; private running = false; private t = 0;
  constructor(private p: Platform, deps: { quran: QuranDB; phoneme?: PhonemeDB | null; translation?: TranslationPipeline | null }, private ev: BasirahEvents = {}) {
    this.session = new Session(deps);
    p.audio.onChunk((pcm, t) => { this.t = t; this.cur?.engine.pushAudio(pcm, t); });
    p.audio.onStatus((s, why) => this.session.log.push({ at: this.t, msg: `micro : ${s} — ${why}` }));
  }
  get activeKind() { return this.kind; }
  setMode(m: Mode) { this.session.setMode(m); }
  async selectEngine(kind: 'offline' | 'online'): Promise<boolean> {
    const make = this.p.engines[kind];
    if (!make) { this.ev.error?.(`Moteur ${kind} non disponible sur cette plateforme.`); return false; }
    let h: EngineHandle;
    try { h = await make(); await h.engine.load(); } catch (e) { this.ev.error?.(`Chargement du moteur ${kind} impossible : ${(e as Error).message}`); return false; }
    const old = this.cur; // le nouveau moteur est prêt AVANT de lâcher l'ancien : pas de trou d'écoute
    this.session.attachEngine(h.engine, h.unit);
    h.engine.on('state', (s: RecognizerState, why: string) => {
      if (h !== this.cur) return;
      if ((s === 'error' || s === 'network-disconnected') && this.kind === 'online') this.ev.suggestion?.(`Le moteur en ligne est indisponible (${why}). Passer en hors ligne ?`);
    });
    this.cur = h; this.kind = kind;
    if (old) await old.engine.dispose();
    return true;
  }
  async start() { if (this.running) return; this.running = true; await this.p.audio.start(); }
  async stop() { this.running = false; await this.p.audio.stop(); await this.cur?.engine.flush(); }
}
