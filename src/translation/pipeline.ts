import type { RecognitionResult } from '../types.ts';

/** Mode Traduction : transcription GÉNÉRALE (aucun filtre Coran, aucun alignement) puis traduction. Même capture audio, même interface de moteur. */
export interface Translator {
  readonly id: string; readonly kind: 'online' | 'offline';
  /** Langues cible gérées ; vide = inconnu tant que non configuré. */
  targets(): string[];
  available(): Promise<{ ok: boolean; reason?: string }>;
  translate(text: string, from: string, to: string, signal?: AbortSignal): Promise<string>;
}
export interface Subtitle { id: number; source: string; lang: string; target: string | null; targetLang: string; status: 'partial' | 'final' | 'translated' | 'error'; error?: string; engineId: string; translatorId: string }

/** Traducteur indisponible : dit pourquoi, au lieu de fabriquer une traduction. Sert de marqueur tant qu'aucun modèle hors ligne n'est branché. */
export class UnavailableTranslator implements Translator {
  readonly kind: 'online' | 'offline';
  constructor(kind: 'online' | 'offline', readonly id: string, private reason: string) { this.kind = kind; }
  targets() { return []; }
  async available() { return { ok: false, reason: this.reason }; }
  async translate(): Promise<string> { throw new Error(this.reason); }
}
/** Traducteur HTTP vers un service Basirah (à héberger) : POST {text,from,to} → {text}. URL et jeton = configuration, jamais en dur. */
export class HttpTranslator implements Translator {
  readonly kind = 'online' as const;
  constructor(readonly id: string, private url: string, private token: () => Promise<string>, private langs: string[], private fetchFn: typeof fetch = fetch) {}
  targets() { return this.langs; }
  async available() { try { const r = await this.fetchFn(this.url, { method: 'OPTIONS' }); return { ok: r.ok || r.status === 405 || r.status === 204 }; } catch (e) { return { ok: false, reason: (e as Error).message }; } }
  async translate(text: string, from: string, to: string, signal?: AbortSignal): Promise<string> {
    const r = await this.fetchFn(this.url, { method: 'POST', signal, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + await this.token() }, body: JSON.stringify({ text, from, to }) });
    if (!r.ok) throw new Error('service de traduction : HTTP ' + r.status);
    const j = await r.json() as { text?: string }; if (typeof j.text !== 'string') throw new Error('réponse de traduction invalide'); return j.text;
  }
}

export interface PipelineOptions { sourceLang: string; targetLang: string; maxQueue?: number; keep?: number }
/** Sous-titres : un provisoire remplace la ligne en cours ; un définitif la fige et lance UNE traduction (file bornée, plus récent d'abord si retard). */
export class TranslationPipeline {
  readonly subtitles: Subtitle[] = [];
  private cur: Subtitle | null = null; private nextId = 1; private queue: Subtitle[] = []; private busy = false; private fns: ((s: Subtitle[]) => void)[] = [];
  dropped = 0;
  constructor(private translator: Translator, private o: PipelineOptions) {}
  onUpdate(f: (s: Subtitle[]) => void) { this.fns.push(f); }
  setTranslator(t: Translator) { this.translator = t; } // changement explicite (en ligne ⇄ hors ligne) : l'historique reste
  setTarget(lang: string) { this.o.targetLang = lang; }
  info() { return { translator: this.translator.id, kind: this.translator.kind, targets: this.translator.targets(), source: this.o.sourceLang, target: this.o.targetLang }; }
  private emit() { this.fns.forEach(f => f(this.subtitles)); }
  push(r: RecognitionResult) {
    if (!r.text.trim()) return;
    if (!this.cur) { this.cur = { id: this.nextId++, source: '', lang: r.language, target: null, targetLang: this.o.targetLang, status: 'partial', engineId: r.engineId, translatorId: this.translator.id }; this.subtitles.push(this.cur); }
    this.cur.source = r.text.trim();
    if (r.isFinal) { this.cur.status = 'final'; this.enqueue(this.cur); this.cur = null; }
    const keep = this.o.keep ?? 200; while (this.subtitles.length > keep) this.subtitles.shift();
    this.emit();
  }
  private enqueue(s: Subtitle) {
    this.queue.push(s); const mq = this.o.maxQueue ?? 8;
    while (this.queue.length > mq) { const d = this.queue.shift()!; d.status = 'error'; d.error = 'traduction abandonnée : retard'; this.dropped++; }
    void this.pump();
  }
  private async pump() {
    if (this.busy) return; this.busy = true;
    try { while (this.queue.length) { const s = this.queue.shift()!;
      try { s.target = await this.translator.translate(s.source, s.lang || this.o.sourceLang, s.targetLang); s.status = 'translated'; s.translatorId = this.translator.id; }
      catch (e) { s.status = 'error'; s.error = (e as Error).message; }
      this.emit(); } }
    finally { this.busy = false; }
  }
  async idle() { while (this.busy || this.queue.length) await new Promise(r => setTimeout(r, 1)); }
}
