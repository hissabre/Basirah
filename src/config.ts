/** Configuration unique (JSON). Toute valeur « <À_RENSEIGNER> » est un espace réservé : `unresolved()` la liste, rien n'est deviné. */
export const PLACEHOLDER = '<À_RENSEIGNER>';
export interface BasirahConfig {
  build: 'internal' | 'commercial';
  quran: { dataPath: string; sourceDescriptorPath: string };
  offline: { engine: 'zipformer'; modelPath: string; tokensPath: string; lexiconPath: string; numThreads: number; maxBacklogSec: number };
  online: { relayUrl: string; tokenEndpoint: string; provider: 'deepgram' | 'mock' | string; language: string; maxRetries: number };
  translation: { sourceLang: string; targetLang: string; onlineUrl: string | null; offlineModelPath: string | null };
  behaviour: { autoFallbackToOffline: boolean };
}
export function unresolved(cfg: unknown, path = ''): string[] {
  if (typeof cfg === 'string') return cfg === PLACEHOLDER || cfg.includes(PLACEHOLDER) ? [path] : [];
  if (cfg && typeof cfg === 'object') return Object.entries(cfg).flatMap(([k, v]) => unresolved(v, path ? path + '.' + k : k));
  return [];
}
export function validateConfig(c: any): string[] {
  const e: string[] = [];
  if (!['internal', 'commercial'].includes(c?.build)) e.push('build doit valoir internal ou commercial');
  for (const k of ['quran', 'offline', 'online', 'translation', 'behaviour']) if (!c?.[k]) e.push(`section « ${k} » manquante`);
  if (c?.behaviour?.autoFallbackToOffline === true) e.push('autoFallbackToOffline=true est refusé : aucune bascule silencieuse de moteur (la bascule est un choix explicite de l\'utilisateur)');
  if (typeof c?.offline?.numThreads !== 'number' || c.offline.numThreads < 1) e.push('offline.numThreads invalide');
  return e;
}
