import type { RecognitionEngine } from '../types.ts';
/**
 * Ports : tout ce qui dépend de la plateforme. Le cœur (alignement, session, modes) n'importe RIEN d'autre que ces interfaces.
 * Navigateur : AudioCapture + moteurs en ligne/WASM · Android/iOS : micro natif + sherpa-onnx natif via pont · Lunettes : micro/SoC du fabricant.
 */
export interface AudioSourcePort {
  start(): Promise<void>; stop(): Promise<void>;
  onChunk(cb: (pcm: Float32Array, audioStart: number) => void): void;
  onStatus(cb: (s: 'running' | 'interrupted' | 'suspended' | 'stopped', why: string) => void): void;
}
export interface EngineHandle { engine: RecognitionEngine; unit: 'text' | 'phoneme' }
export interface Platform {
  audio: AudioSourcePort;
  /** Fabriques de moteurs disponibles sur cette plateforme (absent = non supporté ici, dit clairement à l'utilisateur). */
  engines: { offline?: () => Promise<EngineHandle>; online?: () => Promise<EngineHandle> };
  storage?: { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void> };
}
