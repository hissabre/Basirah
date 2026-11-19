import type { RecognitionEngine, RecognizerEvents, RecognitionResult, RecognizerState } from '../types.ts';
import { norm, sim, skeleton } from '../quran/normalize.ts';

export interface WorkerLike { postMessage(m: unknown, t?: Transferable[]): void; onmessage: ((e: { data: any }) => void) | null; onerror?: ((e: any) => void) | null; terminate?(): void }
export interface WhisperOptions {
  /** Fabrique du worker (navigateur : Worker sur Blob ; tests : faux worker). */
  spawn: () => Promise<WorkerLike> | WorkerLike;
  model?: string; gpu?: boolean; /** URL absolue du dossier models/ embarqué (contient Xenova/whisper-base/…). Si fourni : AUCUN téléchargement externe. */ localBase?: string;
  /** Fenêtre d'écoute en secondes (contexte donné à Whisper à chaque passe). */
  windowSec?: number;
  /** Nouveau son minimal entre deux passes (s). Une seule passe à la fois : jamais de file d'attente. */
  minHopSec?: number;
  /** Mots du Coran connus (squelettes) : filtre le bruit et les hallucinations. */
  knownSkeletons?: Set<string>;
  /** Si défini : tous les mots sauf les N derniers sont transmis dès la passe (rapide). Sinon : accord entre deux passes (sûr). */
  holdback?: number;
}
/**
 * Whisper dans le navigateur (hors ligne après le premier téléchargement du modèle), en flux continu :
 * un seul micro, fenêtre glissante, UNE passe à la fois, puis « local agreement » entre passes successives :
 * un mot n'est transmis que s'il est identique dans deux passes consécutives (sauf après un silence : tout est validé).
 * Whisper n'est pas un modèle en flux : le retard plancher est (durée d'une passe + pas entre passes), pas des millisecondes.
 */
export class WhisperEngine implements RecognitionEngine {
  readonly kind = 'offline' as const; readonly id: string; setHoldback(n: number | undefined) { this.o.holdback = n; }
  private fns: { [K in keyof RecognizerEvents]?: RecognizerEvents[K][] } = {}; private w: WorkerLike | null = null;
  private buf: Float32Array[] = []; private bufN = 0; private clock = 0; private lastRunClock = -9; private busy = false; private runStart = 0;
  private committed: string[] = []; private prevTail: string[] = []; private lastVoice = 0; private latencies: number[] = [];
  runs = 0; skippedSilent = 0; filtered = 0; overlapMisses = 0; lastLatMs: number | null = null; lastRms = 0; dev = 'wasm';
  constructor(private o: WhisperOptions) { this.id = 'whisper:' + (o.model ?? 'Xenova/whisper-base') + ' (hors ligne)'; }
  on<K extends keyof RecognizerEvents>(ev: K, fn: RecognizerEvents[K]) { (this.fns[ev] ??= [] as never).push(fn as never); }
  private st(s: RecognizerState, why: string) { (this.fns.state as ((s: string, w: string) => void)[] | undefined)?.forEach(f => f(s, why)); }
  private emit(text: string, isFinal: boolean, end: number) {
    const r: RecognitionResult = { text, unit: 'text', language: 'ar', audioStart: this.clock, audioEnd: end, receivedAt: performance.now(), isFinal, confidence: null, engine: 'offline', engineId: this.id };
    (this.fns.result as ((r: RecognitionResult) => void)[] | undefined)?.forEach(f => f(r));
  }
  async load() {
    this.st('loading-model', this.o.localBase ? 'démarrage du moteur hors ligne (modèle embarqué dans l\'application)' : 'démarrage du moteur hors ligne (le modèle se télécharge la première fois)');
    this.w = await this.o.spawn();
    await new Promise<void>((resolve, reject) => {
      const w = this.w!;
      w.onerror = (e: any) => { const m = 'le moteur ne démarre pas (' + (e?.message || 'réseau bloqué ?') + ')'; this.st('error', m); reject(new Error(m)); };
      w.onmessage = e => {
        const d = e.data;
        if (d.prog && d.prog.status === 'progress') this.st('loading-model', `téléchargement du modèle (une seule fois) ${Math.round(d.prog.progress || 0)} %`);
        if (d.dev) this.dev = d.dev;
        if (d.ready) { this.st('idle', `modèle prêt (${this.dev === 'webgpu' ? 'GPU' : 'processeur'})`); w.onmessage = ev => this.onWorker(ev.data); resolve(); }
        if (d.err) { this.st('error', 'Whisper : ' + d.err); reject(new Error(d.err)); }
      };
      w.postMessage({ init: 1, gpu: !!this.o.gpu, model: this.o.model ?? 'Xenova/whisper-base', local: this.o.localBase });
    });
    this.st('listening', 'écoute');
  }
  pushAudio(pcm: Float32Array, audioStart: number) {
    this.buf.push(pcm); this.bufN += pcm.length; this.clock = audioStart + pcm.length / 16000;
    const max = 30 * 16000; while (this.buf.length > 1 && this.bufN - this.buf[0].length >= max) this.bufN -= this.buf.shift()!.length;
    let e = 0; for (let i = 0; i < pcm.length; i += 8) e += pcm[i] * pcm[i]; const rms = Math.sqrt(e / Math.max(1, pcm.length / 8)); this.lastRms = rms;
    if (rms > 0.0012) this.lastVoice = this.clock;
    // silence prolongé : on valide ce qui restait en attente (fin de phrase)
    if (this.prevTail.length && this.clock - this.lastVoice > 1.5 && !this.busy) { const t = this.prevTail; this.prevTail = []; this.committed.push(...t); this.trim(); this.emit(t.join(' '), true, this.clock); }
    this.maybeRun();
  }
  private windowSec() { const lat = this.lastLatMs ? this.lastLatMs / 1000 : 1; return this.o.windowSec ?? Math.min(20, Math.max(6, lat * 2 + 4)); }
  private maybeRun() {
    if (this.busy || !this.w) return;
    if (this.clock - this.lastRunClock < (this.o.minHopSec ?? 0.5)) return;
    if (this.clock - this.lastVoice > 2.5) { this.skippedSilent++; return; } // rien d'audible récemment : pas de passe (évite les hallucinations sur le silence)
    const n = Math.round(this.windowSec() * 16000), all = new Float32Array(this.bufN); let o = 0; for (const b of this.buf) { all.set(b, o); o += b.length; }
    const a = all.length > n ? all.subarray(all.length - n) : all;
    // normalisation de gain (micro faible), comme l'ancienne version
    let en = 0; for (let i = 0; i < a.length; i += 16) en += a[i] * a[i]; const rms = Math.sqrt(en / Math.max(1, a.length / 16));
    const out = Float32Array.from(a); if (rms < 0.08 && rms > 0) { const g = Math.min(40, 0.08 / rms); for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i] * g)); }
    this.busy = true; this.lastRunClock = this.clock; this.runStart = performance.now(); this.runs++;
    this.w.postMessage({ audio: out }, [out.buffer]);
  }
  private trim() { if (this.committed.length > 80) this.committed.splice(0, this.committed.length - 80); }
  private loopy(nw: string[]) { if (nw.length < 12) return false; const s = new Set<string>(); for (let i = 0; i + 2 < nw.length; i++) s.add(nw[i] + ' ' + nw[i + 1] + ' ' + nw[i + 2]); return s.size / (nw.length - 2) < 0.4; }
  /** Nombre de mots de tête de `h` déjà connus (fin de `committed`). */
  private overlap(h: string[]) {
    if (!this.committed.length) return 0;
    const L = Math.min(this.committed.length, 40), tail = this.committed.slice(this.committed.length - L); let best = -9, ov = 0;
    for (let s = 0; s < L; s++) { const n = Math.min(L - s, h.length); if (n < 2) continue; let m = 0; for (let i = 0; i < n; i++) if (sim(tail[s + i], h[i]) >= 0.7) m++;
      if (m >= Math.min(3, n) && m / n >= 0.6) { const sc = m - (n - m) * 1.5; if (sc > best) { best = sc; ov = n; } } }
    return ov;
  }
  private onWorker(d: any) {
    if (d.dev) this.dev = d.dev;
    if (d.err) { this.busy = false; this.st('error', 'Whisper : ' + d.err); return; }
    if (d.text === undefined) return;
    this.busy = false; this.lastLatMs = performance.now() - this.runStart; this.latencies.push(this.lastLatMs); if (this.latencies.length > 50) this.latencies.shift();
    const h = norm(String(d.text)).split(' ').filter(Boolean);
    if (!h.length) { this.maybeRun(); return; }
    const ks = this.o.knownSkeletons;
    if (ks && h.length >= 4 && h.filter(w => ks.has(skeleton(w))).length / h.length < 0.7) { this.filtered++; this.maybeRun(); return; }
    if (this.loopy(h)) { this.filtered++; this.maybeRun(); return; }
    const ov = this.overlap(h); if (this.committed.length && ov === 0 && h.length > 3) this.overlapMisses++;
    const tail = h.slice(ov);
    // accord entre deux passes consécutives : seuls les mots identiques sont transmis
    let k = 0;
    if (this.o.holdback != null) k = Math.max(0, tail.length - this.o.holdback);
    else while (k < tail.length && k < this.prevTail.length && sim(tail[k], this.prevTail[k]) >= 0.85) k++;
    this.prevTail = tail.slice(k);
    if (k > 0) { const ok = tail.slice(0, k); this.committed.push(...ok); this.trim(); this.emit(ok.join(' '), true, this.clock); }
    this.maybeRun();
  }
  async flush() { if (this.prevTail.length) { const t = this.prevTail; this.prevTail = []; this.committed.push(...t); this.emit(t.join(' '), true, this.clock); } }
  async dispose() { try { this.w?.terminate?.(); } catch { /* ignoré */ } this.w = null; this.buf = []; this.bufN = 0; }
  stats() { const l = this.latencies; return { queued: this.busy ? 1 : 0, lastLatencyMs: this.lastLatMs, medianMs: l.length ? [...l].sort((a, b) => a - b)[l.length >> 1] : null, runs: this.runs, skippedSilent: this.skippedSilent, filtered: this.filtered, overlapMisses: this.overlapMisses } as { queued: number; lastLatencyMs: number | null }; }
}

/** Crée le worker Whisper dans le navigateur : module, sinon classique, sinon sur le fil principal (comme l'ancienne version). */
export async function spawnWhisperWorker(src: string): Promise<WorkerLike> {
  const url = (s: string) => URL.createObjectURL(new Blob([s], { type: 'text/javascript' }));
  const probe = (o: WorkerOptions) => new Promise<boolean>(res => { try { const w = new Worker(url('postMessage(1)'), o), t = setTimeout(() => { try { w.terminate(); } catch { /* */ } res(false); }, 3000); w.onmessage = () => { clearTimeout(t); w.terminate(); res(true); }; w.onerror = () => { clearTimeout(t); res(false); }; } catch { res(false); } });
  if (await probe({ type: 'module' })) return new Worker(url(src), { type: 'module' }) as unknown as WorkerLike;
  if (await probe({})) return new Worker(url(src)) as unknown as WorkerLike;
  const host: any = { onmessage: null, onerror: null, terminate() {}, postMessage(d: unknown) { Promise.resolve().then(() => S2.onmessage && S2.onmessage({ data: d })); } };
  const S2: any = { onmessage: null, postMessage(d: unknown) { Promise.resolve().then(() => host.onmessage && host.onmessage({ data: d })); } };
  new Function('self', src)(S2); return host;
}
