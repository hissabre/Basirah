import type { RecognitionEngine } from '../types.ts';
/** Fait passer un PCM 16 kHz dans un moteur par blocs de 100 ms (comme un micro), plus vite que le temps réel ; mesure le facteur temps réel. */
export async function runPcm(engine: RecognitionEngine, pcm: Float32Array, blockSec = 0.1, now = () => performance.now()) {
  const n = Math.round(16000 * blockSec), t0 = now();
  for (let i = 0; i < pcm.length; i += n) { engine.pushAudio(pcm.subarray(i, i + n), i / 16000); await new Promise(r => setTimeout(r, 0)); }
  await engine.flush();
  const wall = (now() - t0) / 1000, audio = pcm.length / 16000;
  return { audioSec: audio, wallSec: wall, rtf: wall / audio };
}
export function readWav(buf: Uint8Array): Float32Array {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (String.fromCharCode(...buf.subarray(0, 4)) !== 'RIFF') throw new Error('WAV attendu');
  let p = 12, fmt: { ch: number; sr: number; bits: number; tag: number } | null = null;
  while (p + 8 <= buf.length) {
    const id = String.fromCharCode(...buf.subarray(p, p + 4)), size = v.getUint32(p + 4, true);
    if (id === 'fmt ') fmt = { tag: v.getUint16(p + 8, true), ch: v.getUint16(p + 10, true), sr: v.getUint32(p + 12, true), bits: v.getUint16(p + 22, true) };
    if (id === 'data') {
      if (!fmt) throw new Error('fmt manquant'); const f = fmt, n = Math.floor(size / (f.bits / 8) / f.ch), out = new Float32Array(n);
      for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < f.ch; c++) { const o = p + 8 + (i * f.ch + c) * (f.bits / 8); s += f.bits === 16 ? v.getInt16(o, true) / 32768 : f.tag === 3 ? v.getFloat32(o, true) : (v.getUint8(o) - 128) / 128; } out[i] = s / f.ch; }
      if (f.sr !== 16000) throw new Error(`WAV à ${f.sr} Hz : convertir en 16 kHz mono (ffmpeg -ar 16000 -ac 1)`); return out;
    }
    p += 8 + size + (size % 2);
  }
  throw new Error('chunk data introuvable');
}
