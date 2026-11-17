import type { RecognitionEngine, RecognizerEvents, RecognitionResult, RecognizerState } from '../types.ts';
/**
 * MOTEUR DE TEST — API de reconnaissance vocale de Chrome/Edge (`webkitSpeechRecognition`, arabe).
 * Ce N'EST PAS le moteur de Basirah : l'audio part chez le fournisseur du navigateur, la précision sur le Coran est INCONNUE,
 * et le navigateur coupe la session de lui-même. Aucun redémarrage automatique : quand elle s'arrête, l'état passe à « idle »
 * avec la raison, et l'utilisateur relance. Il possède son propre micro (pas d'AudioCapture en parallèle).
 */
export const speechSupported = () => typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
export class WebSpeechEngine implements RecognitionEngine {
  readonly kind = 'online' as const; readonly id = 'browser-speech:ar-SA (test)';
  private fns: { [K in keyof RecognizerEvents]?: RecognizerEvents[K][] } = {}; private rec: any = null; private t0 = 0; private n = 0; private ev: string[] = [];
  on<K extends keyof RecognizerEvents>(ev: K, fn: RecognizerEvents[K]) { (this.fns[ev] ??= [] as never).push(fn as never); }
  private st(s: RecognizerState, why: string) { (this.fns.state as ((s: string, w: string) => void)[] | undefined)?.forEach(f => f(s, why)); }
  async load() { if (!speechSupported()) { this.st('error', 'reconnaissance vocale du navigateur absente (utiliser Chrome ou Edge)'); throw new Error('webkitSpeechRecognition indisponible'); } this.st('idle', 'prêt'); }
  begin() {
    const C = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition; const r = this.rec = new C();
    r.lang = 'ar-SA'; r.continuous = true; r.interimResults = true; this.t0 = performance.now(); this.st('requesting-mic', 'demande du micro');
    this.ev = []; const mark = (k: string) => { this.ev.push(k); };
    for (const k of ['audiostart', 'soundstart', 'speechstart', 'speechend', 'soundend', 'audioend', 'nomatch']) r['on' + k] = () => mark(k);
    r.onstart = () => this.st('listening', 'session ouverte');
    r.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const a = e.results[i], now = (performance.now() - this.t0) / 1000;
        const res: RecognitionResult = { text: a[0].transcript, unit: 'text', language: 'ar', audioStart: Math.max(0, now - 2), audioEnd: now, receivedAt: performance.now(), isFinal: a.isFinal, confidence: a.isFinal && a[0].confidence ? a[0].confidence : null, engine: 'online', engineId: this.id };
        this.n++; (this.fns.result as ((r: RecognitionResult) => void)[] | undefined)?.forEach(f => f(res));
      }
    };
    r.onerror = (e: any) => this.st(e.error === 'no-speech' ? 'idle' : 'error', 'erreur navigateur : ' + e.error);
    r.onend = () => {
      const heard = this.ev.includes('audiostart'), sound = this.ev.includes('soundstart');
      this.st('idle', `session terminée par le navigateur (événements : ${this.ev.join(', ') || 'aucun'}; résultats : ${this.n}). ` +
        (!heard ? 'Chrome n\'a JAMAIS reçu d\'audio : micro par défaut de Chrome muet, bloqué ou occupé — vérifier chrome://settings/content/microphone et le micro par défaut de Windows. ' : !sound ? 'Chrome a ouvert le micro mais n\'a détecté aucun son : micro muet ou niveau nul. ' : '') + 'Appuyez sur Démarrer pour reprendre (pas de redémarrage automatique).');
    };
    try { r.start(); } catch (e) { this.st('error', 'démarrage impossible : ' + (e as Error).message); }
  }
  pushAudio() {} async flush() { try { this.rec?.stop(); } catch {} } async dispose() { try { this.rec?.abort(); } catch {} this.rec = null; }
  stats() { return { queued: 0, lastLatencyMs: null }; }
}
