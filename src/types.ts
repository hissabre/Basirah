/** Contrat commun à tous les moteurs de reconnaissance (en ligne, hors ligne, rejeu de test). */
export type EngineKind = 'online' | 'offline' | 'replay';

export interface RecognitionResult {
  /** Texte arabe reconnu pour ce segment. */
  text: string;
  /** 'text' = mots arabes ; 'phoneme' = unités phonétiques (ex. Zipformer Quran-Lab) fournies dans `tokens`. */
  unit: 'text' | 'phoneme';
  tokens?: string[];
  language: string;
  /** Début du segment, en secondes depuis le début de la session audio (horloge audio, pas horloge murale). */
  audioStart: number;
  /** Fin du segment (secondes audio). */
  audioEnd: number;
  /** Horloge murale (performance.now) à la réception : sert à mesurer la latence. */
  receivedAt: number;
  /** false = hypothèse provisoire susceptible de changer ; true = segment définitif. */
  isFinal: boolean;
  /** 0..1 si le moteur la fournit, sinon null (jamais inventée). */
  confidence: number | null;
  engine: EngineKind;
  engineId: string; // ex. "whisper.cpp:tarteel-base-q5", "deepgram:nova-3"
}

export type RecognizerState =
  | 'idle' | 'requesting-mic' | 'initializing' | 'loading-model' | 'listening'
  | 'processing' | 'recovering' | 'network-disconnected' | 'mic-interrupted' | 'error';

export interface RecognizerEvents {
  result: (r: RecognitionResult) => void;
  state: (s: RecognizerState, reason: string) => void;
}

/** Un moteur reçoit de l'audio PCM 16 kHz mono et émet des résultats ; il ne touche jamais au micro. */
export interface RecognitionEngine {
  readonly kind: EngineKind;
  readonly id: string;
  load(signal?: AbortSignal): Promise<void>;
  /** Appelé en continu avec des blocs PCM ; doit rendre la main immédiatement (file bornée côté moteur). */
  pushAudio(pcm: Float32Array, audioStart: number): void;
  /** Vide la file, finalise le segment en cours. */
  flush(): Promise<void>;
  dispose(): Promise<void>;
  on<K extends keyof RecognizerEvents>(ev: K, fn: RecognizerEvents[K]): void;
  /** Profondeur de file et dernière latence, pour le panneau de diagnostic. */
  stats(): { queued: number; lastLatencyMs: number | null };
}

export interface Position {
  surah: number; ayah: number;
  /** Index du mot dans le verset (0-based). */
  word: number;
  /** Index global du mot dans le corpus. */
  index: number;
}
