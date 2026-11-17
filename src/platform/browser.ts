import { AudioCapture } from '../audio/capture.ts';
import type { AudioSourcePort } from './ports.ts';
/** Adaptateur navigateur : AudioCapture → AudioSourcePort. */
export class BrowserAudioSource implements AudioSourcePort {
  private chunk: (p: Float32Array, t: number) => void = () => {}; private status: (s: any, w: string) => void = () => {};
  private cap = new AudioCapture({ onChunk: (p, t) => this.chunk(p, t), onStatus: (s, w) => this.status(s === 'requesting' ? 'suspended' : s, w) });
  start() { return this.cap.start(); } stop() { return this.cap.stop(); }
  onChunk(cb: (p: Float32Array, t: number) => void) { this.chunk = cb; } onStatus(cb: (s: any, w: string) => void) { this.status = cb; }
  stats() { return this.cap.stats(); }
}
