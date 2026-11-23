/**
 * Fbank « Kaldi » (80 bandes, 25 ms / 10 ms) en TypeScript pur — mêmes étapes que kaldi-native-fbank / sherpa-onnx :
 * fenêtres sans coupure des bords (snip_edges=false, bords réfléchis), retrait de la composante continue, préaccentuation 0,97,
 * fenêtre de Povey, FFT 512, spectre de puissance, bandes mel 20 Hz → (8000−400) Hz, log avec plancher epsilon.
 *
 * ÉTAT : écrit d'après la description de l'algorithme ; PAS encore comparé à la référence numérique du modèle
 * (golden.json, produit par tools/inspect_quran_asr_tiny.py). Tant que cette comparaison n'est pas faite, la précision de reconnaissance
 * obtenue avec ces fbank n'est pas garantie : un décalage de réglage dégrade silencieusement le modèle.
 */
export interface FbankOptions {
  sampleRate: number; numBins: number; frameLen: number; frameShift: number; fft: number;
  lowFreq: number; highFreq: number; preemph: number; eps: number;
  /** 1 si les échantillons sont en [-1,1] et que le modèle l'attend ainsi ; 32768 sinon (convention Kaldi). À trancher avec golden.json. */
  scale: number;
}
export const DEFAULT_FBANK: FbankOptions = { sampleRate: 16000, numBins: 80, frameLen: 400, frameShift: 160, fft: 512, lowFreq: 20, highFreq: 7600, preemph: 0.97, eps: 1.1920929e-7, scale: 1 };

const mel = (f: number) => 1127 * Math.log(1 + f / 700);

export class Fbank {
  private win: Float64Array; private bank: { start: number; w: Float64Array }[]; private cos: Float64Array; private sin: Float64Array; private rev: Uint32Array;
  constructor(readonly o: FbankOptions = DEFAULT_FBANK) {
    const N = o.frameLen; this.win = new Float64Array(N);
    for (let i = 0; i < N; i++) this.win[i] = Math.pow(0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)), 0.85);
    const nfft = o.fft, half = nfft / 2, binW = o.sampleRate / nfft, ml = mel(o.lowFreq), mh = mel(o.highFreq), d = (mh - ml) / (o.numBins + 1);
    this.bank = [];
    for (let b = 0; b < o.numBins; b++) {
      const l = ml + b * d, c = l + d, r = l + 2 * d; let first = -1; const ws: number[] = [];
      for (let i = 0; i < half; i++) { const m = mel(binW * i); let w = 0; if (m > l && m < r) w = m <= c ? (m - l) / (c - l) : (r - m) / (r - c); if (w > 0 && first < 0) first = i; if (first >= 0) ws.push(w); }
      this.bank.push({ start: Math.max(0, first), w: Float64Array.from(ws) });
    }
    this.cos = new Float64Array(half); this.sin = new Float64Array(half);
    for (let i = 0; i < half; i++) { this.cos[i] = Math.cos(2 * Math.PI * i / nfft); this.sin[i] = -Math.sin(2 * Math.PI * i / nfft); }
    this.rev = new Uint32Array(nfft); const bits = Math.log2(nfft);
    for (let i = 0; i < nfft; i++) { let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b); this.rev[i] = r; }
  }
  numFrames(nSamples: number) { return nSamples <= 0 ? 0 : Math.floor((nSamples + this.o.frameShift / 2) / this.o.frameShift); }
  private fft(re: Float64Array, im: Float64Array) {
    const n = re.length;
    for (let i = 0; i < n; i++) { const j = this.rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let size = 2; size <= n; size <<= 1) {
      const hs = size >> 1, step = n / size;
      for (let s = 0; s < n; s += size) for (let k = 0; k < hs; k++) {
        const wr = this.cos[k * step], wi = this.sin[k * step], a = s + k, b = a + hs;
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
  /** pcm : Float32 mono 16 kHz. Renvoie [frames × numBins] à plat. */
  compute(pcm: Float32Array): Float32Array {
    const o = this.o, T = this.numFrames(pcm.length), out = new Float32Array(T * o.numBins), N = o.frameLen, n = pcm.length;
    const re = new Float64Array(o.fft), im = new Float64Array(o.fft), fr = new Float64Array(N), power = new Float64Array(o.fft / 2);
    for (let t = 0; t < T; t++) {
      const start = t * o.frameShift + Math.floor(o.frameShift / 2) - Math.floor(N / 2);
      let mean = 0;
      for (let s = 0; s < N; s++) { let k = s + start; while (k < 0 || k >= n) k = k < 0 ? -k - 1 : 2 * n - 1 - k; fr[s] = pcm[k] * o.scale; mean += fr[s]; }
      mean /= N; for (let s = 0; s < N; s++) fr[s] -= mean;
      for (let s = N - 1; s > 0; s--) fr[s] -= o.preemph * fr[s - 1]; fr[0] -= o.preemph * fr[0];
      re.fill(0); im.fill(0); for (let s = 0; s < N; s++) re[s] = fr[s] * this.win[s];
      this.fft(re, im); for (let i = 0; i < o.fft / 2; i++) power[i] = re[i] * re[i] + im[i] * im[i];
      for (let b = 0; b < o.numBins; b++) { const { start: s0, w } = this.bank[b]; let e = 0; for (let i = 0; i < w.length; i++) e += w[i] * power[s0 + i]; out[t * o.numBins + b] = Math.log(Math.max(e, o.eps)); }
    }
    return out;
  }
}
