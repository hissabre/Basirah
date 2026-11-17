import type { RecognitionEngine, RecognizerEvents, RecognitionResult, RecognizerState } from '../types.ts';
/**
 * TajweedFormer V4 via le SDK web de Quran-Lab (@quran-lab/tajweedformer, WebAssembly, licence NPL-1.2).
 * API utilisée, d'après la documentation publique lue le 2026-11-17 : TajweedClient.create({key}) → client.model() → model.listen({endOnSilenceMs}) → session.chunks
 * (chunk.decoded = {text, tokens[{id,name,firstMs,peakMs,lastMs,confidence}], words, settled, isFinal}).
 * NON TESTÉ : le paquet n'a jamais été chargé ni exécuté par l'auteur (pas d'accès au réseau de développement). Le SDK possède le micro (pas d'AudioCapture en parallèle).
 * La sortie brute du dernier chunk est exposée (`lastRaw`) pour que le vrai format soit constaté avant d'écrire l'alignement.
 */
export class TajweedFormerEngine implements RecognitionEngine {
  readonly kind = 'online' as const; readonly id = 'quranlab:tajweedformer-v4 (SDK)';
  private fns: { [K in keyof RecognizerEvents]?: RecognizerEvents[K][] } = {}; private model: any = null; private session: any = null; private stopped = false; private t0 = 0;
  lastRaw: unknown = null; chunks = 0;
  constructor(private o: { key: string; sdkUrl: string; endOnSilenceMs?: number; onRaw?: (c: unknown) => void }) {}
  on<K extends keyof RecognizerEvents>(ev: K, fn: RecognizerEvents[K]) { (this.fns[ev] ??= [] as never).push(fn as never); }
  private st(s: RecognizerState, why: string) { (this.fns.state as ((s: string, w: string) => void)[] | undefined)?.forEach(f => f(s, why)); }
  async load() {
    if (!this.o.key) throw new Error('Clé web Quran-Lab absente (à créer sur sdk.quranlab.ai, pour l\'adresse https de cette page).');
    if (!isSecureContext) throw new Error('Le SDK exige https (ou localhost).');
    this.st('loading-model', 'chargement du SDK puis du modèle (≈ 57 Mo la première fois)');
    let mod: any; try { mod = await import(/* @vite-ignore */ this.o.sdkUrl); } catch (e) { throw new Error(`Chargement du SDK impossible depuis ${this.o.sdkUrl} : ${(e as Error).message}`); }
    const TC = mod.TajweedClient ?? mod.default?.TajweedClient; if (!TC) throw new Error('Le module chargé ne contient pas TajweedClient (clés : ' + Object.keys(mod).join(', ') + ')');
    try { const client = await TC.create({ key: this.o.key }); this.model = await client.model(); } catch (e) { throw new Error('Initialisation du SDK refusée : ' + (e as Error).message + ' (clé valide ? adresse de la page enregistrée pour cette clé ?)'); }
    this.st('idle', 'SDK et modèle prêts');
  }
  async begin() {
    this.stopped = false; this.t0 = performance.now(); this.st('requesting-mic', 'demande du micro (par le SDK)');
    try {
      this.session = await this.model.listen({ endOnSilenceMs: this.o.endOnSilenceMs ?? 8000 }); this.st('listening', 'écoute');
      for await (const chunk of this.session.chunks) {
        if (this.stopped) break; this.chunks++; this.lastRaw = chunk; this.o.onRaw?.(chunk);
        const d = chunk.decoded ?? {}, now = (performance.now() - this.t0) / 1000;
        const toks: string[] = Array.isArray(d.tokens) ? d.tokens.slice(0, d.settled ?? d.tokens.length).map((t: any) => t.name) : [];
        const r: RecognitionResult = { text: String(d.text ?? ''), unit: 'phoneme', tokens: toks, language: 'ar', audioStart: 0, audioEnd: now, receivedAt: performance.now(), isFinal: !!d.isFinal, confidence: null, engine: 'online', engineId: this.id };
        (this.fns.result as ((r: RecognitionResult) => void)[] | undefined)?.forEach(f => f(r));
      }
      this.st('idle', 'prise terminée (silence ou arrêt) — appuyez sur Démarrer pour une nouvelle prise');
    } catch (e) { this.st('error', 'écoute impossible : ' + (e as Error).message); }
  }
  pushAudio() {} async flush() { this.stopped = true; try { await this.session?.stop?.(); } catch {} } async dispose() { this.stopped = true; try { await this.session?.stop?.(); } catch {} this.session = null; }
  stats() { return { queued: 0, lastLatencyMs: null }; }
}
