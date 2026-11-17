/**
 * Pont vers sherpa-onnx. NON EXÉCUTÉ dans l'environnement de développement actuel (pas d'accès réseau aux paquets ni au modèle) :
 * les appels ci-dessous suivent l'API publique documentée de sherpa-onnx (OnlineRecognizer / OnlineStream) et DOIVENT être
 * vérifiés contre la version installée (voir docs/07-ZIPFORMER.md, liste de contrôle).
 */
export interface SherpaChunkResult { tokens: string[]; text: string; endpoint: boolean; timestamps?: number[] }

/** Contrat minimal et asynchrone : une implémentation peut vivre dans un Worker, un thread natif, ou le même fil. */
export interface SherpaBackend {
  init(): Promise<void>;
  /** Donne UN bloc audio au flux de reconnaissance (aucune fenêtre, aucun chevauchement), décode tout ce qui est prêt, renvoie l'état courant. */
  process(pcm: Float32Array): Promise<SherpaChunkResult>;
  /** Remet le flux à zéro (après un point de fin d'énoncé ou une reprise). */
  reset(): Promise<void>;
  dispose(): Promise<void>;
}

export interface ZipformerFiles { model: string; tokens: string; numThreads?: number }

/** Backend Node (tests/bancs d'essai sur ordinateur) via le paquet npm `sherpa-onnx-node`. */
export function nodeBackend(files: ZipformerFiles, endpoint = { rule1: 2.4, rule2: 1.2, rule3: 20 }): SherpaBackend {
  let rec: any = null, stream: any = null;
  return {
    async init() {
      const sherpa: any = await import('sherpa-onnx-node' as string);
      rec = new sherpa.OnlineRecognizer({
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: { zipformer2Ctc: { model: files.model }, tokens: files.tokens, numThreads: files.numThreads ?? 2, provider: 'cpu', debug: 0 },
        decodingMethod: 'greedy_search',
        enableEndpoint: true,
        rule1MinTrailingSilence: endpoint.rule1, rule2MinTrailingSilence: endpoint.rule2, rule3MinUtteranceLength: endpoint.rule3,
      });
      stream = rec.createStream();
    },
    async process(pcm) {
      stream.acceptWaveform({ sampleRate: 16000, samples: pcm });
      while (rec.isReady(stream)) rec.decode(stream);
      const r = rec.getResult(stream);
      return { tokens: r.tokens ?? [], text: r.text ?? '', endpoint: !!rec.isEndpoint(stream), timestamps: r.timestamps };
    },
    async reset() { rec.reset(stream); },
    async dispose() { rec = null; stream = null; },
  };
}
